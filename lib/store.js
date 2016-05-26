const Rx   = require('rxjs')
const uuid = require('node-uuid')
const invariant = require('./invariant')

function isPromise(promise) {
  return promise && typeof promise.then === 'function'
}

function isObservable(observable) {
  return observable && typeof observable.subscribe === 'function'
}

function create(spec) {
  invariant(
    spec && typeof spec === 'object', 
    'Store.create(...): expect an object as argument, given : %s', spec
  )
  
  invariant(
    spec.getInitialValue && typeof spec.getInitialValue === 'function', 
    'Store.create(...): getInitialValue should be a function given : %s', spec.getInitialValue
  )
  

  invariant(
    !spec.getOperations || typeof spec.getOperations === 'function', 
    'Store.create(...): getOperations should be a function given : %s', spec.getOperations
  )
  
  
  let getInitialValue = spec.getInitialValue
  let getOperations = spec.getOperations
  
  //State
  let value = null
  let observers = Object.create(null)
  let operationsMap = Object.create(null)
  let operationsStack = []
  let valueSubscription = null
  let operationSubscription = null
  let isPending = true
  
  function hasObservers() {
    return !!Object.keys(observers).length
  }
  
  
  function notifyObservers(error) {
    Object.keys(observers).forEach(uid => {
      if (error) {
        return observers[uid].onError(error)
      } else {
        observers[uid].onNext(value)
      }
    })
  }
  
  function init() {
    let initialValue = getInitialValue()
    if (isPromise(initialValue)) {
      initialValue.then(setValue, notifyObservers)
    } else if (isObservable(initialValue)) {
      valueSubscription = initialValue.subscribe(setValue, notifyObservers)
    } else {
      setValue(initialValue)
    }
  }
  
  function setValue(val) {
    value = val
    isPending = false
    initOperations()
    notifyObservers()
  }
  
  function disposeOperations() {
    if (operationSubscription) {
      operationSubscription.dispose()
    }
    
    operationSubscription = null
    operationsMap = Object.create(null)
    operationsStack = []
  }
  
  function initOperations() {
    disposeOperations()

    if (getOperations) {
      let operations = getOperations()
      if (!isObservable(operations)) {
        throw new TypeError('getOperations(): should return an observable, given : ' + operations)
      }
      operationSubscription = operations.subscribe(operationObservers)
    }
  }
  
  function dispose() {
    if (valueSubscription) {
      valueSubscription.dispose()
    }
    disposeOperations()
    value = null
    valueSubscription = null
    isPending = true
  }

  function cancelOperation(uid) {
    if (!operationsMap[uid]) {
        return
    }

    let oldValue = operationsMap[uid].oldValue
    let index = operationsStack.indexOf(uid)

    value = operationsStack.slice(index + 1).reduce(function (value, uid) {
        let descriptor = operationsMap[uid]
        descriptor.oldValue = value
        return applyOperation(value, descriptor.operation)
    }, oldValue)

    operationsStack.splice(index, 1)
    delete operationsMap[uid]
    notifyObservers()
  }

  function confirmOperation(uid) {
    if (!operationsMap[uid]) {
        return
    }
    operationsMap[uid].confirmed = true
    let lastIndex = -1
    operationsStack.every((uid, index) => {
      if (operationsMap[uid].confirmed) {
          delete operationsMap[uid]
          lastIndex = index
          return true
      }
    })

    operationsStack = operationsStack.slice(lastIndex + 1)
  }

  function operationObservers(operation) {
    invariant(
      operation && typeof operation === 'object',
      'invalid operation, operations should be an object, given : %s', operation
    )
    
    invariant(
      operation.value || 
      (
        operation.transform && 
        typeof operation.transform === 'function'
      ),
      'invalid operation, operations should have a value or a transform property'
    )

    
    let oldValue = value
    value = applyOperation(value, operation)
    notifyObservers()


    let uid = uuid.v1()
    operationsMap[uid] = {
      operation: operation,
      oldValue: oldValue
    }
    operationsStack.push(uid)

    if ('confirm' in operation) {
      invariant(
        isPromise(operation.confirm),
        'invalid operation, confirm should be a promise, given : %s', operation.confirm
      )
      
      operation.confirm.then(() => {
        confirmOperation(uid)
      }, () => {
        cancelOperation(uid) 
      })
    } else {
      confirmOperation(uid)
    }
  }


  function applyOperation (value, operation) {
    return 'value' in operation ? 
      operation.value : 
      operation.transform(value)
  }
  
  
  function subscribe (observer) {

    let uid = uuid.v1()

    if (!hasObservers()) {
      init()
    }

    observers[uid] = observer

    if (!isPending) {
      observer.onNext(value)
    }

    return Rx.Disposable.create(() => {
      delete observers[uid]
      if (!hasObservers()) {
        dispose()
      }
    })
  }
  
  return Rx.Observable.create(subscribe)
}

module.exports = { create }

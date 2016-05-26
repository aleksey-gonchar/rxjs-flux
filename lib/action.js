'use strict'
const Rx = require('rxjs');

const slice = Array.prototype.slice

function create(map) {
  let observers = []
  
  let actionStart = new Rx.Subject()
  let actionEnd = new Rx.Subject()
  
  const action = (value) => {
    if (typeof map !== 'undefined') {
      if (typeof map === 'function') {
        value = map(value)
      } else {
        value = map
      }
    } 
    
    actionStart.onNext(value)
    var os = observers.slice(0)
    for (var i = 0, len = os.length; i < len; i++) {
        os[i].onNext(value)
    }
    actionEnd.onNext()
    
    return value
  }
  
  for (var key in Rx.Observable.prototype) {
    action[key] = Rx.Subject.prototype[key]
  }
  
  Rx.Observable.call(action, observer => {
      observers.push(observer)
      return {
        dispose: () => {
          var index = observers.indexOf(observer)
          if (index !== -1) {
            observers.splice(index, 1)
          }
        }
      }
  })
  
  action.hasObservers  = () => {
    return observers.length > 0 || actionStart.hasObservers() || actionEnd.hasObservers()
  }
  
  action.waitFor = (observables, selector) => {
    if (!Array.isArray(observables)) {
      observables = [observables]
    }
    return actionStart
      .flatMap(value => {
        return Rx.Observable.combineLatest(
          observables.map(observable => {
            observable =  observable.takeUntil(actionEnd).publish()
            observable.connect()
            return observable
          }),
          (observablesValues) => {
            if (selector) {
              observablesValues = slice.call(arguments)
              observablesValues.unshift(value)
              return selector.apply(void(0), observablesValues)
            } else {
              return value
            }
          }
        )
      })
  }

  return action
}

module.exports = { create }
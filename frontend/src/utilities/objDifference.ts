import * as _ from 'lodash';

export const objDifference = (object, base) => {
  return _.transform(object, (result, value, key) => {
    if (!_.isEqual(value, base[key])) {
      result[key] = (_.isObject(value) && _.isObject(base[key])) ? objDifference(value, base[key]) : value;
    }
  })
}

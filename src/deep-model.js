/*jshint expr:true eqnull:true */
/**
 *
 * Improves Backbone Model support when nested attributes are used.
 * get() and set() can take paths e.g. 'user.name'
 *
 *
 */
;(function(factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['underscore', 'backbone'], factory);
    } else {
        // globals
        factory(_, Backbone);
    }
}(function(_, Backbone) {
    
    /**
     * Takes a nested object and returns a shallow object keyed with the path names
     * e.g. { "level1.level2": "value" }
     *
     * @param  {Object}      Nested object e.g. { level1: { level2: 'value' } }
     * @return {Object}      Shallow object with path names e.g. { 'level1.level2': 'value' }
     */
    function objToPaths(obj) {
        var ret = {},
            separator = DeepModel.keyPathSeparator;

        for (var key in obj) {
            var val = obj[key];

            if (val && val.constructor === Object && !_.isEmpty(val)) {
                //Recursion for embedded objects
                var obj2 = objToPaths(val);

                for (var key2 in obj2) {
                    var val2 = obj2[key2];

                    ret[key + separator + key2] = val2;
                }
            } else {
                ret[key] = val;
            }
        }

        return ret;
    }

    /**
     * @param {Object}  Object to fetch attribute from
     * @param {String}  Object path e.g. 'user.name'
     * @return {Mixed}
     */
    function getNested(obj, path, return_exists) {
        var separator = DeepModel.keyPathSeparator;

        var fields = path.split(separator);
        var result = obj;
        return_exists || (return_exists === false);
        for (var i = 0, n = fields.length; i < n; i++) {
            if (return_exists && !_.has(result, fields[i])) {
                return false;
            }
            result = result[fields[i]];

            if (result == null && i < n - 1) {
                result = {};
            }
            
            if (typeof result === 'undefined') {
                if (return_exists)
                {
                    return true;
                }
                return result;
            }
        }
        if (return_exists)
        {
            return true;
        }
        return result;
    }

    /**
     * @param {Object} obj                Object to fetch attribute from
     * @param {String} path               Object path e.g. 'user.name'
     * @param {Object} [options]          Options
     * @param {Boolean} [options.unset]   Whether to delete the value
     * @param {Mixed}                     Value to set
     */
    function setNested(obj, path, val, options) {
        options = options || {};

        var separator = DeepModel.keyPathSeparator;

        var fields = path.split(separator);
        var result = obj;
        for (var i = 0, n = fields.length; i < n && result !== undefined ; i++) {
            var field = fields[i];

            //If the last in the path, set the value
            if (i === n - 1) {
                options.unset ? delete result[field] : result[field] = val;
            } else {
                //Create the child object if it doesn't exist, or isn't an object
                if (typeof result[field] === 'undefined' || ! _.isObject(result[field])) {
                    result[field] = {};
                }

                //Move onto the next part of the path
                result = result[field];
            }
        }
    }

    function deleteNested(obj, path) {
      setNested(obj, path, null, { unset: true });
    }

    var DeepModel = Backbone.Model.extend({

        // Override get
        // Supports nested attributes via the syntax 'obj.attr' e.g. 'author.user.name'
        get: function(attr) {
            return getNested(this.attributes, attr);
        },

        //override default set
        set: function(key, val, options) {
          var attr, attrs;
          if (key == null) return this;

          // Handle both `"key", value` and `{key: value}` -style arguments.
          if (_.isObject(key)) {
            attrs = key;
            options = val;
          } else {
            (attrs = {})[key] = val;
          }

          // Extract attributes and options.
          var silent = options && options.silent;
          var unset = options && options.unset;

          // Run validation.
          if (!this._validate(attrs, options)) return false;

          // Check for changes of `id`.
          if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

          var now = this.attributes;

          // For each `set` attribute...
          for (attr in attrs) {
            val = attrs[attr];

            // Update or delete the current value, and track the change.
            unset ? deleteNested(now, attr) : setNested(now, attr, val);
            this._changes.push(attr, val);
          }

          // Signal that the model's state has potentially changed, and we need
          // to recompute the actual changes.
          this._hasComputed = false;

          // Fire the `"change"` events.
          if (!silent) this.change(options);
          return this;
        },

        _computeChanges: function(loud) {
          //!start custom code
          var separator = DeepModel.keyPathSeparator;
          //!end custom code

          this.changed = {};
          var already = {};
          var triggers = [];
          var current = this._currentAttributes;
          var changes = this._changes;

          // Loop through the current queue of potential model changes.
          for (var i = changes.length - 2; i >= 0; i -= 2) {
            var key = changes[i], val = changes[i + 1];
            if (already[key]) continue;
            already[key] = true;

            // Check if the attribute has been modified since the last change,
            // and update `this.changed` accordingly. If we're inside of a `change`
            // call, also add a trigger to the list.
            if (current[key] !== val) {
              this.changed[key] = val;
              if (!loud) continue;
              triggers.push(key, val);
              current[key] = val;

              //!start custom code
              //Add ancestor path changes
              var path = key.split(separator),
                  ancestorKey;
              path.splice(-1);
              while (path.length) {
                ancestorKey = path.join(separator)+'.*';

                triggers.push(ancestorKey, val);

                path.splice(-1);
              }
              //!end custom code
            }
          }
          if (loud) this._changes = [];

          // Signals `this.changed` is current to prevent duplicate calls from `this.hasChanged`.
          this._hasComputed = true;
          return triggers;
        },

        /*hasChanged: function(attr) {
          if (!this._hasComputed) this._computeChanges();

          //Empty objects indicate no changes, so remove these first
          var self = this;
          _.each(this.changed, function(val, key) {
            if (_.isObject(val) && _.isEmpty(val)) {
              delete self.changed[key];
            }
          });

          if (attr == null) return !_.isEmpty(this.changed);
          return _.has(this.changed, attr);
        },*/

        changedAttributes: function(diff) {
          if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
          var val, changed = false, old = objToPaths(this._previousAttributes);
          for (var attr in objToPaths(diff)) {
            if (_.isEqual(old[attr], (val = diff[attr]))) continue;
            (changed || (changed = {}))[attr] = val;
          }

          return changed;
        }

    });


    //Config; override in your app to customise
    DeepModel.keyPathSeparator = '.';


    //Exports
    Backbone.DeepModel = DeepModel;

    //For use in NodeJS
    if (typeof module != 'undefined') module.exports = DeepModel;
    
    return Backbone;

}));

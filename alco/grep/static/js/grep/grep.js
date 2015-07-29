(function($, _, Backbone) {

	/* helpers */

	var colorizeTrigger = function(elem, active) {
	    elem.attr('data-active', active + '');
	    elem.toggleClass('label-default', !active);
	    elem.toggleClass('label-success', active);
    };


	var filterEvents = _.extend({}, Backbone.Events);

    /* models */
    var LogModel = Backbone.Model.extend({
	    toJSON: function () {
		    var result = Backbone.Model.prototype.toJSON.call(this);
		    result['time'] = this.time();
		    result['shortHost'] = this.shortHost();
		    result['level'] = this.level();
		    result['columns'] = this.collection.columns;
		    return result;
	    },
	    level: function() {
		    return this.get('js')['levelname'];
	    },
	    time: function () {
		    return this.get('datetime').split('T')[1].replace('000', '');
	    },
	    shortHost: function() {
		    return (this.get('js').host || '').split('.')[0]
	    }
    });


	var BaseFilterModel = Backbone.Model.extend({
		defaults: {
            name: null,
            active: true
	    },
		triggerEvent: 'visible-changed',

		triggerFilterChange: function(options) {
			this.trigger(this.triggerEvent, this, options);
		}
	});

	var ColumnModel = BaseFilterModel.extend({
		name: 'ColumnModel',
		defaults: {
            name: null,
            visible: true
	    },
		triggerEvent: 'column-visible-changed'
	});

	var DateModel = BaseFilterModel.extend({
		name: 'DateModel',
		defaults: {
            date: null,
            active: true
	    },

		triggerEvent: 'date-active-changed'

	});

	var FieldModel = BaseFilterModel.extend({
		name: 'FieldModel',
		defaults: {
            name: null,
			active: true,
            value: null
	    },

		triggerEvent: 'field-active-changed'

	});

    /* collections */

    var ColumnCollection = Backbone.Collection.extend({
	    model: ColumnModel,
	    isActive: function (model) {
		    return model.get('visible')
	    },
	    updateActiveState: function (model) {
		    if (this.filter(this.isActive).length == 0){
			    for (var i=0; i<this.models.length; i++) {
				    var cur = this.models[i];
				    cur.set({'visible': true});
			    }
		    }
		    filterEvents.trigger('filter-changed', 'columns');
	    },

	    initialize: function (models, options) {
		    var params = (options|| {}).queryParams || {};
		    var columns = params['columns'];
		    if (columns)
			    columns = columns.split(',');

		    for (var i=0; i<models.length; i++){
			    var m = models[i];
			    m.on(m.triggerEvent, this.updateActiveState, this);
			    if (columns)
				    m.set('visible', _.contains(columns, m.get('name')));
		    }
	    },

	    getFilterParams: function() {
			var visible = this.filter(this.isActive);
			if (visible.length == 0 || visible.length == this.models.length)
				return {};
		    return {columns: visible.map(function(model) {
					return model.get('name')
				}).join(',')}
		}
    });

    var DateCollection = Backbone.Collection.extend({
	    model: DateModel,
	    updateActiveState: function (model) {
		    var seen = false;
		    for (var i=0; i<this.models.length; i++) {
			    var cur = this.models[i];
			    if (cur.get('date') == model.get('date')) {
				    seen = true;
			    }
			    if (i < this.models.length - 1)
			        cur.set({'active': seen});
			    else
			        cur.set({'active': true});
		    }
		    filterEvents.trigger('filter-changed', 'dates');
	    },

	    initialize: function (models, options) {
		    var params = (options|| {}).queryParams || {};
		    var start_ts = params.start_ts;
		    var date = null;
		    if (start_ts) {
			    date = start_ts.split(' ')[0]
		    }
		    for (var i=0; i<models.length; i++){
			    var m = models[i];
			    m.on('date-active-changed', this.updateActiveState, this);
			    if (date)
				    m.set('active', m.get('date') >= date);
		    }
		    models[models.length - 1].set('active', true);
	    },

		getFilterParams: function() {
			var active = _.first(this.filter(function (model) {
				return model.get('active')
			}));
			var date = active.get('date');
			return {start_ts: date}
		}

    });

    var FieldCollection = Backbone.Collection.extend({
	    model: FieldModel,
	    isActive: function (model) {
		    return model.get('active')
	    },
	    updateActiveState: function (model, options) {
		    var cur, i, ctrl = (options || {})['ctrl'] || false;
		    var field = false;
		    var selected = this.filter(this.isActive).length;
		    var currentActive = model.get('active');
		    for (i=0; i<this.models.length; i++) {
			    cur = this.models[i];
			    var current = cur.get('value') == model.get('value');
				if (!ctrl) {
					cur.set('active', current);
				} else {
					if (selected == 0)
						// all disabled - revert to all active
						cur.set('active', true);
					//else if (cure)
					//	cur.set('active', current)
				}
		    }
		    filterEvents.trigger('filter-changed', 'field-' + field);
	    },

	    initialize: function (models, options) {
		    options = options|| {};
		    var params = options.queryParams || {};
		    var filterName = options.filterName;
		    var values = params[filterName];
		    if (values)
			    values = [values];
		    else {
			    values =  params[filterName + '__in'];
			    if (values) values = values.split(',')
		    }

		    for (var i=0; i<models.length; i++){
			    var m = models[i];
			    m.on(m.triggerEvent, this.updateActiveState, this);
			    if (values)
				    m.set('active', _.contains(values, m.get('value')));
		    }
	    },

	    getFilterParams: function() {
			var visible = this.filter(this.isActive);
			if (visible.length == 0 || visible.length == this.models.length)
				return {};
		    var result = {};
		    var suffix = (visible.length > 1)? '__in': '';
		    result[visible[0].get('field') + suffix] = visible.map(function(model) {
					return model.get('value')
				}).join(',');
			return result;
		}
    });

	var LogCollection = Backbone.Collection.extend({
        model: LogModel,
        url: '/api/grep/',

        initialize: function(queryParams) {
            this.page = 1;
            this.logger_index = queryParams['logger_index'] || 'logger';
	        delete queryParams['logger_index'];
	        if (queryParams['columns'])
	            this.columns = queryParams['columns'].split(',');
	        delete queryParams['columns']
	        this.url += this.logger_index + '/';
            this.has_next = true;
            this.loading = false;
            this.queryParams = queryParams || {};
        },

        parse: function(resp) {
            this.has_next = resp['next'] || false;
            return resp['results'];
        },

	    reset: function(models, options) {
		    Backbone.Collection.prototype.reset.apply(this, [models, options]);
		    this.has_next = true;
		    this.page = 1;
	    },

        loadMore: function() {
            if (this.loading || !this.has_next) {
                return false;
            }


	        var params = {
                'page': this.page
            };
            _.extend(params, this.queryParams);

            this.loading = true;
            this.page += 1;

            var res = this.fetch({
                data: params
            });
            $.when(res).then(_.bind(function(e, x, y) {
                this.loading = false;
	            this.trigger("loaded");
            }, this));
            return res;
        },
        getUrl: function() {
            return this.url + '?' + $.param(this.queryParams, 'page');
        }
    });

    /* views */

    var LogView = Backbone.View.extend({
        tagName: 'div',
        className: 'log-line',

        template: _.template($('#log-template').html()),

        initialize: function() {
            this.listenTo(this.model, 'change', this.render);
        },

        render: function() {
            this.$el.html(this.template(this.model.toJSON()));
            return this;
        }
    });


	var BaseFilterItemView = Backbone.View.extend({
		tagName: 'a',
		events: {
			'click': 'toggleFilter'
		},
		stateField: 'active',
		nameField: 'name',

		initialize: function() {
			this.listenTo(this.model, 'change:' + this.stateField, this.colorize)
		},


		toggleFilter: function(e){
			e.preventDefault();
			var active = !this.model.get(this.stateField);
			this.model.set(this.stateField, active);
			console.log(this.model.name + "." + this.model.get(this.nameField) + " now is " + active);
			// add separate version of change:active event, because of
			// modifications of model done by collection
			this.model.triggerFilterChange({ctrl: window.event.ctrlKey});
		},

		colorize: function(model) {
			colorizeTrigger(this.$el, model.get(this.stateField));
		}
	});

	var ColumnView = BaseFilterItemView.extend({
		name: 'ColumnView',
		className: 'column-trigger',
		stateField: 'visible'
	});

	var BaseFilterView = Backbone.View.extend({
		name: 'BaseFilterView',
		fields: {
			'active': 'active',
			'name': 'name',
			'value': 'value'
		},

		model: Backbone.Model.extend({}),
		itemView: Backbone.View.extend({}),
		collection: Backbone.Collection.extend({}),
		itemSelector: '.filter-trigger',

		initialize: function (options) {
			this.itemViews = [];
			var models = this.initItemViews();
			this.collection = new this.collection(models, options);
		},

		initItemViews: function () {
			var self = this;
			return _.map(this.$el.find(this.itemSelector), function (el) {
				var elem = $(el);
				var data = {};
				for (var modelKey in this.fields) {
					if (!this.fields.hasOwnProperty(modelKey))
						continue;
					var elemKey = this.fields[modelKey];
					data[modelKey] = elem.data(elemKey);
				}
				var model = new this.model(data);
				var view = new this.itemView({el: el, model: model});
				self.itemViews.push(view);
				return model;
			}, this);
		},

		getFilterParams: function(){
			return this.collection.getFilterParams();
		}
	});

	var ColumnFilterView = BaseFilterView.extend({
		name: 'ColumnFilterView',
		el: "#columns-trigger-container",
		itemSelector: '.column-trigger',
		model: ColumnModel,
		itemView: ColumnView,
		collection: ColumnCollection,
		fields: {
			'visible': 'active',
			'name': 'value'
		}
	});

	var DateView = BaseFilterItemView.extend({
		name: 'DateView',
		className: 'dates-trigger',
		nameField: 'date'
	});

	var DateFilterView = BaseFilterView.extend({
		name: 'DateFilterView',
		el: "#dates-trigger-container",
		itemSelector: '.dates-trigger',
		model: DateModel,
		itemView: DateView,
		collection: DateCollection,
		events: {
			'keydown #start-time': 'updateStartTime'
		},
		fields: {
			date: 'value',
			active: 'active'
		},

		initStartTime: function (options) {
			var params = (options || {}).queryParams || {};
			var start_ts = (params || {})['start_ts'] || '';
			var tokens = start_ts.split(' ', 2);
			if (tokens.length > 1)
				this.time = tokens[1];
			else
				this.time = '';
			this.timeInput = this.$el.find('#start-time');
			this.timeInput.val(this.time);
		},

		initialize: function(options) {
			BaseFilterView.prototype.initialize.call(this, options);
			this.initStartTime(options);
		},

		updateStartTime: function(e) {
			if (e.keyCode != 13)
				return;
			e.preventDefault();
			this.time = this.timeInput.val();

			filterEvents.trigger('filter-changed', 'time');
		},

		getFilterParams: function() {
			var params = BaseFilterView.prototype.getFilterParams.call(this);
			if(params['start_ts'] && this.time) {
				params['start_ts'] += ' ' + this.time;
			}
			return params;
		}
	});

	var FieldView = BaseFilterItemView.extend({
		name: 'FieldView',
		className: 'filter-trigger',
		nameField: 'field'

	});

	var FieldFilterView = BaseFilterView.extend({
		name: 'FieldFilterView',
		itemSelector: '.filter-trigger',
		model: FieldModel,
		itemView: FieldView,
		collection: FieldCollection,
		fields: {
			value: 'value',
			active: 'active',
			field: 'field'
		},

		initialize: function (options) {
			BaseFilterView.prototype.initialize.call(this, options);
			options = options || {};
			this.filterName = options['filterName'];
		}
	});

	var GrepView = Backbone.View.extend({
		el: "#grep-view",
		initialize: function(options) {
			this.queryParams = options['queryParams'] || {};
			this.dateFilterView = new DateFilterView({queryParams: this.queryParams});
			this.columnFilterView = new ColumnFilterView({queryParams: this.queryParams});
			this.resultsView = new ResultsView({
				queryParams: this.queryParams,
				pageUrl: options['pageUrl']
			});
			this.listenTo(filterEvents, 'filter-changed', this.updateQueryParams);
			this.fieldFilters = [];
			_.map($('.filter-trigger-container'), this.initFilterView, this);
		},

		updateQueryParams: function (what) {
			this.queryParams = {};
			_.extend(this.queryParams, this.dateFilterView.getFilterParams());
			_.extend(this.queryParams, this.columnFilterView.getFilterParams());
			_.each(this.fieldFilters, function(view){
				_.extend(this.queryParams, view.getFilterParams());

			}, this);
			if (what == 'columns') {
				this.resultsView.updateVisibility(this.queryParams);
			} else {
				this.resultsView.reloadCollection(this.queryParams);
			}
			console.log(this.queryParams);
		},

		initFilterView: function(el) {
			var filterName = $(el).data('field');
			this.fieldFilters.push(new FieldFilterView({
					el: el,
					queryParams: this.queryParams,
					filterName: filterName
				}));
		}

	});

    var ResultsView = Backbone.View.extend({
        itemView: LogView,
	    el: "#log-list",
	    container: "#log-container",

	    initCollection: function (queryParams) {
		    this.collection = new LogCollection(queryParams);
		    this.listenTo(this.collection, "add", this.appendItem);
		    this.listenTo(this.collection, "loaded", this.checkScroll);
		    this.collection.loadMore();
	    },
	    initialize: function(options) {
		    options = options || {};
		    this.url = options.pageUrl;
		    var queryParams = options.queryParams;
		    this.initCollection(queryParams);
		    this.container = $(this.container);
		    this.container.html('');
	        // prevent of query duplicating on scroll
            $(window).scroll(_.bind(this.checkScroll, this));
        },

	    updateLocation: function (queryParams) {
		    var viewUrl = this.url + '?' + $.param(queryParams);
		    window.history.pushState(null, null, viewUrl);
	    },

	    updateVisibility: function(queryParams) {
		    var columns = queryParams['columns'];

		    if (columns) {
			    $('.column-toggle ').hide();
			    columns = columns.split(',');
			    this.collection.columns = columns;
			    for(var i=0; i< columns.length; i++) {
				    var col = columns[i];
					$('.column-' + col).show();
			    }
		    } else {
			    $('.column-toggle ').show();
			    this.collection.columns = null;
		    }

	    },

	    reloadCollection: function (queryParams) {
		    this.collection.reset();
		    this.stopListening(this.collection, 'add');
		    this.stopListening(this.collection, 'loaded');
		    this.container.html('');
		    this.initCollection(queryParams);
		    this.updateLocation(queryParams);
	    },

	    checkScroll: function() {
            var contentOffset = this.container.offset().top,
                contentHeight = this.container.height(),
                pageHeight = $(window).height(),
                scrollTop = $(window).scrollTop();
            var triggerPoint = 200;

            if (contentOffset + contentHeight - scrollTop - pageHeight < triggerPoint) {
                this.collection.loadMore();
            }
        },

        appendItem: function(item) {
            var itemView = new this.itemView({
                model: item
            });
            this.container.append(itemView.render().el);
        },

        render: function() {
            return this;
        },

        remove: function() {
            Backbone.View.prototype.remove.call(this, arguments);

            // disable scroll events subscription
            $(window).off('scroll');
        }

    });

    /* routers */
    var LogsRouter = Backbone.Router.extend({

        routes: {
            'grep/:logger_index/': 'grep'
        },

	    parseQueryString: function (queryString){
		    var params = {};
		    if(queryString){
		        _.each(
		            _.map(decodeURI(queryString).split(/&/g),function(el,i){
		                var aux = el.split('='), o = {};
		                if(aux.length >= 1){
		                    var val = undefined;
		                    if(aux.length == 2)
		                        val = aux[1];
		                    o[aux[0]] = decodeURIComponent(val);
		                }
		                return o;
		            }),
		            function(o){
		                _.extend(params,o);
		            }
		        );
		    }
		    return params;
		},

        grep: function(logger_index) {
			var query_string = window.location.search.substring(1);

            if (this.view) {
                this.view.remove();
            }

	        var queryParams = this.parseQueryString(query_string);

            this.view = new GrepView({
				pageUrl: window.location.pathname,
	            queryParams: queryParams
            });

        }
    });


    var router = new LogsRouter();
    Backbone.history.start({pushState: true});

})($, _, Backbone);
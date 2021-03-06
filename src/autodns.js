var xml2js = require('xml2js')
var request = require('superagent')
var Errors = require('./errors')


function AutoDNS (opts) {
	this.url = opts.url || 'https://gateway.autodns.com/'
	this.defaults = {
		language: opts.language || 'en',
		auth: {
			user: opts.user,
			password: opts.password,
			context: opts.context || '1'
		}
	}

	this.builder = new xml2js.Builder({
		renderOpts: {
			pretty: false
		}
	})
	this.parser = new xml2js.Parser({
		explicitArray: false
	})
}


// AutoDNS.prototype.setZoneMain = function (main) {
// 	var zone = this.defaults.zone = this.defaults.zone || {}
// 	zone.ns_action = zone.ns_action || 'complete'
// 	zone.main = {
// 		value: main.value || main,
// 		ttl: main.ttl || '86400'
// 	}
// }

AutoDNS.prototype.setZoneSOA = function (soa) {
	var zone = this.defaults.zone = this.defaults.zone || {}
	zone.ns_action = zone.ns_action || 'complete'
	zone.soa = {}

	if (+soa.level) {
		zone.soa.level = soa.level
	}
	else if (soa.ttl || soa.refresh || soa.retry || soa.expire) {
		zone.soa.level = '0'
		// Default to recommended settings from AutoDNS docs
		zone.soa.ttl = soa.ttl || '86400'
		zone.soa.refresh = soa.refresh || '43200'
		zone.soa.retry = soa.retry || '7200'
		zone.soa.expire = soa.expire || '1209600'
	}
	else {
		zone.soa.level = '1'
	}

	if ('ignore' in soa) zone.soa.ignore = soa.ignore
	if ('email' in soa) zone.soa.email = soa.email
}

AutoDNS.prototype.setZoneNameservers = function (nameservers) {
	var zone = this.defaults.zone = this.defaults.zone || /* istanbul ignore next: not sure how to cover this */ {}
	zone.nserver = nameservers.map(function (ns) {
		var nameserver = {
			name: ns.name || ns
		}
		if (ns.ttl) nameserver.ttl = ns.ttl
		return nameserver
	})
}


AutoDNS.prototype.request = function (data, done) {
	var payload = this.builder.buildObject({ request: data })

	var req = request
		.post(this.url)
		.type('xml')
		.send(payload)

	if (process.env.NOCK_BACK_MODE === 'record') {
		// remove encoding header to make Nock fixtures more readable
		req.unset('Accept-Encoding')
	}

	req.end(function (err, res) {
			if (err) return done(err)
			this.parser.parseString(res.text, function (err, xml) {
				if (err) return done(err)
				done(null, xml.response)
			})
		}.bind(this))
}


AutoDNS.prototype.createZone = function (name, records, done) {
	var zone = {
		name: name,
		// set a default ns_action in case it's not added
		// by the defaults below
		ns_action: 'complete'
	}
	if (records) {
		zone.rr = records.map(function (record) {
			var rr = {
				name: record.name,
				type: record.type,
				value: record.value
			}
			if ('priority' in record) rr.pref = record.priority
			if ('ttl' in record) rr.ttl = record.ttl
			return rr
		})
	}

	if ('zone' in this.defaults) {
		var defaults = this.defaults.zone
		;['main', 'ns_action', 'soa', 'nserver'].forEach(function (key) {
			if (key in defaults) {
				zone[key] = defaults[key]
			}
		}.bind(this))
	}

	if (zone.ns_action === 'complete' || zone.ns_action === 'primary') {
		if (!zone.soa) {
			return done(new Error('Missing SOA for "' + zone.ns_action + '" ns_action'))
		}
		if (!zone.nserver) {
			return done(new Error('Missing nameservers for "' + zone.ns_action + '" ns_action'))
		}
	}

	return this.request({
		auth: this.defaults.auth,
		language: this.defaults.language,
		task: {
			code: '0201',
			zone: zone
		}
	}, function (err, response) {
		if (err) return done(err)

		var result = response.result

		if (result.status.type === 'error') {
			err = new Errors.GatewayError(result.msg.code, result.msg.text, result.msg.object)
			return done(err, result)
		}

		done(null, result)
	})
}

/* istanbul ignore next */
AutoDNS.prototype.updateZone = function () {
	// not yet implemented
}

/* istanbul ignore next */
AutoDNS.prototype.deleteZone = function () {
	// not yet implemented
}


module.exports = AutoDNS

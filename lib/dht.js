var EventEmitter = require('events').EventEmitter;
var hat = require('hat');
var dgram = require('dgram');
var bncode = require('bncode');
var compact2string = require('compact2string');

var MAX_TRANSIT = 100;
var MAX_NODES = 5000;

var parseNodeInfo = function(compact) {
	try {
		var nodes = [];
		for (var i = 0; i < compact.length; i += 26) {
			nodes.push(compact2string(compact.slice(i+20, i+26)));
		}
		return nodes;
	} catch(err) {
		return [];
	}
};

var parsePeerInfo = function(list) {
	try {
		return list.map(compact2string);
	} catch (err) {
		return [];
	}
};

var length = function(obj) {
	return Object.keys(obj).length;
};

var BOOTSTRAP_NODES = [
	'dht.transmissionbt.com:6881',
	'router.bittorrent.com:6881',
	'router.utorrent.com:6881'
];

var DHT = function(infoHash) {
	if (!(this instanceof DHT)) return new DHT(infoHash);
	EventEmitter.call(this);

	var self = this;
	var node = function(addr) {
		self.query(addr);
	};
	var peer = function(addr) {
		if (self.peers[addr]) return;
		self.peers[addr] = true;
		self.emit('peer', addr);
	};

	this.peers = {};
	this.visited = {};

	this.nodeId = new Buffer(hat(160), 'hex');
	this.infoHash = typeof infoHash === 'string' ? new Buffer(infoHash, 'hex') : infoHash;

	this.socket = dgram.createSocket('udp4');

	this.socket.on('message', function(message, remote) {
		var addr = remote.address+':'+remote.port;

		self.visited[addr] = Date.now();
		delete self.intransit[addr];

		try {
			message = bncode.decode(message);
		} catch (err) {
			return;
		}

		var r = message && message.r;
		var nodes = r && r.nodes || [];
		var values = r && r.values || [];

		parsePeerInfo(values).forEach(peer);
		parseNodeInfo(nodes).forEach(node);

		if (!self.paused) self.resume();
	});

	this.socket.on('error', function() {
		// do nothing...
	});

	this.message = bncode.encode({t:'1',y:'q',q:'get_peers',a:{id:this.nodeId,info_hash:this.infoHash}});
	this.queue = [];
	this.intransit = {};
	this.paused = false;

	this.clearTransits = setInterval(function() {
		var now = Date.now();

		Object.keys(self.intransit).forEach(function(addr) {
			if (now - self.intransit[addr] > 2000) delete self.intransit[addr];
		});

		if (!self.paused) self.resume();
	}, 1000);

	BOOTSTRAP_NODES.forEach(function(node) {
		self.query(node);
	});
};

DHT.prototype.__proto__ = EventEmitter.prototype;

DHT.prototype.resume = function() {
	this.paused = false;
	while (this.queue.length && this.query(this.queue.pop()));
};

DHT.prototype.pause = function() {
	this.paused = true;
};

DHT.prototype.query = function(addr) {
	if (this.paused || length(this.intransit) > MAX_TRANSIT) {
		if (!this.visited[addr]) this.queue.push(addr);
		return false;
	}

	if (this.visited[addr]) return true;
	this.intransit[addr] = Date.now();
	this.socket.send(this.message, 0, this.message.length, addr.split(':')[1], addr.split(':')[0]);
	return true;
};

DHT.prototype.destroy = function() {
	clearInterval(this.clearTransits);
	this.socket.close();
};

module.exports = DHT;
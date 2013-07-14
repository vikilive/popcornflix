var randomAccessFile = require('random-access-file');
var bisection = require('bisection');
var bitfield = require('bitfield');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var thunky = require('thunky');
var path = require('path');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;

var noop = function() {};

var sha1 = function(data) {
	return crypto.createHash('sha1').update(data).digest('hex');
};

var finder = function(list) {
	var i = 0;
	return function(val) {
		if (list[i] <= val && (i+1 === list.length || val < list[i+1])) return i;
		return i = bisection(list, val)-1;
	};
};

var lastPieceLength = function(torrent) {
	var file = torrent.files[torrent.files.length-1];
	return ((file.offset + file.length) % torrent.pieceLength) || torrent.pieceLength;
};

var Storage = function(folder, torrent, options) {
	if (!(this instanceof Storage)) return new Storage(folder, torrent, options);
	EventEmitter.call(this);

	options = options || {};
	var self = this;

	this.dirname = path.join(folder, torrent.infoHash);
	this.files = torrent.files;
	this.pieces = torrent.pieces;
	this.pieceLength = torrent.pieceLength;
	this.lastPieceLength = torrent.lastPieceLength;
	this.verified = bitfield(torrent.pieces.length);
	this.missing = torrent.pieces.length;

	this.offsets = torrent.files.map(function(file) {
		return (file.offset / torrent.pieceLength) | 0;
	}).filter(function(part, i, offsets) {
		return part !== offsets[i-1];
	});

	this.io = this.offsets.map(function(part, i) {
		return randomAccessFile(path.join(self.dirname, ''+i));
	});

	this.indexOf = finder(this.offsets);

	this.ready = thunky(function(callback) {
		var onready = function() {
			self.emit('ready');
			callback(null, self);
		};

		mkdirp(self.dirname, function(err) {
			if (err) return callback(err);
			if (!options.verify) return onready();

			var i = 0;
			var loop = function() {
				if (i === self.pieces.length) return onready();
				self._read(i++, loop);
			};

			loop();
		});
	});
};

Storage.prototype.__proto__ = EventEmitter.prototype;

Storage.prototype.readable = function(part) {
	return this.verified.get(part);
};

Storage.prototype.read = function(part, callback) {
	callback = callback || noop;
	this.ready(function(err, self) {
		if (err) return callback(err);
		self._read(part, callback);
	});
};

Storage.prototype.writable = function(part, buffer) {
	return sha1(buffer) === this.pieces[part];
};

Storage.prototype.write = function(part, buffer, callback) {
	callback = callback || noop;
	this.ready(function(err, self) {
		if (err) return callback(err);
		self._write(part, buffer, callback);
	});
};

Storage.prototype.destroy = function(callback) {
	callback = callback || noop;
	var self = this;
	this.ready(function() {
		self.io.forEach(function(file) {
			file.close();
		});
		rimraf(self.dirname, function() {
			self.emit('close');
			callback();
		});
	});
};

Storage.prototype._write = function(part, buffer, callback) {
	var i = this.indexOf(part);
	var self = this;
	var offset = this.pieceLength*(part-this.offsets[i]);

	if (!this.writable(part, buffer)) return callback(new Error('buffer cannot be verified'));

	this.io[i].write(offset, buffer, function(err) {
		if (err) return callback(err);
		self._verify(part);
		callback();
	});
};

Storage.prototype._read = function(part, callback) {
	var i = this.indexOf(part);
	var length = part === this.pieces.length-1 ? this.lastPieceLength : this.pieceLength;
	var offset = this.pieceLength*(part-this.offsets[i]);
	var self = this;

	this.io[i].read(offset, length, function(err, buffer) {
		if (err) return callback(err);
		if (!self.verified.get(part) && !self.writable(part, buffer)) return callback(new Error('buffer cannot be verified'));
		self._verify(part);
		callback(null, buffer);
	});
};

Storage.prototype._verify = function(part) {
	if (this.verified.get(part)) return;
	this.verified.set(part, true);
	this.emit('readable', part);
	this.missing--;
	if (!this.missing) this.emit('finish');
};


module.exports = Storage;

if (require.main !== module) return;

require('read-torrent')(__dirname+'/../big.torrent', function(err, torrent) {
	var drive = Storage('/tmp/peerflix', torrent);

	drive.on('ready', function() {
		console.log('i am ready now...');
	});

	drive.write(42, new Buffer('hello world'), console.log);
	drive.read(42, console.log);

	drive.destroy(function() {
		console.log('closed...');
	});
});
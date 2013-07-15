var peerWireSwarm = require('peer-wire-swarm');
var readTorrent = require('read-torrent');
var speedometer = require('speedometer');
var hat = require('hat');
var once = require('once');
var dht = require('./lib/dht');
var pieceBuffer = require('./lib/piece-buffer');
var pieceStream = require('./lib/piece-stream');
var storage = require('./lib/storage');
var selector = require('./lib/selector');

var BLOCK_SIZE = 16*1024; // used for finding offset prio
var MIN_SPEED =  5*1024;
var CHOKE_TIMEOUT = 5000;
var PIECE_TIMEOUT = 30000;
var MIN_PEERS = 0;
var MAX_QUEUED = 5;

var limit = function(fn) {
	var lock = 0;

	var reset = function() {
		if (lock > 1) process.nextTick(run);
		lock = 0;
	};

	var run = function() {
		lock++;
		if (lock > 1) return;
		setTimeout(reset, 1000);
		fn();
	};

	return run;
};

module.exports = function(url, options, callback) {
	if (typeof options === 'function') return module.exports(url, {}, options);

	readTorrent(url, function(err, torrent) {
		if (err) return callback(err);

		var speed = speedometer();
		var peerId = '-PF0006-'+hat(48);
		var swarm = peerWireSwarm(torrent.infoHash, peerId, options);
		var table = dht(torrent.infoHash);
		var drive = storage('/tmp/peerflix', torrent, options);
		var streams = [];

		// TODO: merge the 2 below into drive
		var select = selector(drive);
		var buffers = torrent.pieces.map(function(hash, i) {
			return pieceBuffer(i === torrent.pieces.length-1 ? torrent.lastPieceLength : torrent.pieceLength);
		});

		drive.on('readable', function(i) {
			streams.forEach(function(stream) {
				stream.update();
			});
			swarm.wires.forEach(function(wire) {
				wire.have(i);
			});
		});

		swarm.on('download', function(downloaded) {
			speed(downloaded);
		});

		table.on('peer', function(peer) {
			swarm.add(peer);
		});

		var turbo = function(i) {
			return streams.some(function(stream) {
				return i-stream.target < 3 && i-stream.target >= 0;
			});
		};

		var override = function(piece, wire) {
			var slowest = wire;

			piece.select(wire, function(owner) {
				if (owner.speed() < slowest.speed()) slowest = owner;
			});

			var offset = piece.select(wire, function(owner) {
				if (owner === slowest && wire.speed() / owner.speed() >= 2) {
					console.log('TURBO OVERRIDE: '+owner.speed()+' vs '+wire.speed()+'  -  '+wire.remoteAddress);
					return true;
				}
			});

//			if (offset > -1) console.log('OVERRIDE');

			return offset;
		};

		var update = limit(function() {
			if (!drive.missing) return;

			swarm.wires.forEach(function onwire(wire) {
				if (wire.peerChoking) return;

				var prio = wire.downloaded ? 0 : 20;

				select.next(function(i) {
					if (prio-- > 0) return;
					if (wire.requests >= MAX_QUEUED) return true;
					if (!wire.peerPieces[i] || !buffers[i]) return;

					var fast = turbo(i);
					var piece = buffers[i];
					var offset = piece.select(wire);

					if (offset === -1 && turbo(i) && wire.speed() > MIN_SPEED) offset = override(piece, wire);
					if (offset === -1) return;

					wire.request(i, offset, piece.sizeof(offset), function(err, buffer) {
						if (err) return piece.deselect(offset, wire);

						process.nextTick(function() {
							onwire(wire);
						});

						if (!piece.write(offset, buffer)) return;

						drive.write(i, piece.flush(), function(err) {
							buffers[i] = err ? pieceBuffer(piece.length) : null;
						});
					});

					return true;
				});
			});
		});

		swarm.on('wire', function(wire) {
			if (!drive.missing) return;

			var ontimeout = function() {
				wire.destroy();
			};

			var onchoketimeout = function() {
				if (swarm.wires.length > MIN_PEERS && swarm.queued > 2 * (swarm.size - swarm.wires.length)) return ontimeout();
				timeout = setTimeout(onchoketimeout, CHOKE_TIMEOUT);
			};

			wire.speed = speedometer();

			wire.on('download', wire.speed);
			wire.on('have', update);
			wire.on('unchoke', update);

			wire.on('end', function() {
				clearTimeout(timeout);
				if (wire.downloaded) swarm.prioritize(wire);
				update();
			});

			wire.on('choke', function() {
				clearTimeout(timeout);
				timeout = setTimeout(onchoketimeout, CHOKE_TIMEOUT);
			});

			wire.on('unchoke', function() {
				clearTimeout(timeout);
			});

			wire.on('request', function(part, offset, length, callback) {
				drive.read(part, function(err, buffer) {
					if (err) return callback(err);
					callback(null, buffer.slice(offset, offset+length));
				});
			});

			wire.once('interested', function() {
				wire.unchoke();
			});

			var timeout = setTimeout(onchoketimeout, CHOKE_TIMEOUT);

			wire.setTimeout(PIECE_TIMEOUT, function() {
				wire.destroy();
			});

			wire.setKeepAlive();
			wire.bitfield(drive.verified);
			wire.interested();
		});

		var client = {};

		client.speed = speed;
		client.swarm = swarm;
		client.files = torrent.files;
		client.streams = streams;
		client.select = select;
		client.drive = drive;
		client.torrent = torrent;

		client.destroy = function(callback) {
			swarm.destroy();
			drive.destroy(callback);
		};

		client.missing = function(num) {
			return select.grap(num || 1);
		};

		client.stream = function(index, options) {
			options = options || {};
			var file = torrent.files[index];
			if (!file) return null;

			var start = options.start || 0;
			var end = typeof options.end === 'number' ? options.end : file.length-1;
			var stream = pieceStream(drive, start+file.offset, end-start+1);
			var unprio = select.prioritize(stream.target);

			streams.push(stream);
			stream.once('close', function() {
				streams.splice(streams.indexOf(stream), 1);
				unprio();
			});

			return stream;
		};

		callback(null, client);
	});
};

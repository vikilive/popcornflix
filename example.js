var http = require('http');
var rangeParser = require('range-parser');
var numeral = require('numeral');
var peerflix = require('./index');

var pipeline = function(from, to) {
	from.pipe(to);
	to.on('close', function() {
		from.destroy();
	});
};

peerflix(process.argv[2], function(err, client) {
	if (err) throw err;

	process.on('SIGINT', function() {
		client.destroy(function() {
			process.exit(0);
		});
	});

	var server = http.createServer(function(request, response) {
		request.connection.setTimeout(30*60*1000);

		if (/^\/\d+$/.test(request.url)) {
			var i = parseInt(request.url.slice(1), 10);
			var range = request.headers.range;
			var file = client.files[i];
			range = range && rangeParser(file.length, range)[0];

			if (!file) {
				response.writeHead(404);
				response.end();
				return;
			}

			response.setHeader('Accept-Ranges', 'bytes');

			if (!range) {
				response.setHeader('Content-Length', file.length);
				if (request.method === 'HEAD') return response.end();
				pipeline(client.stream(i), response);
				return;
			}

			response.statusCode = 206;
			response.setHeader('Content-Length', range.end - range.start + 1);
			response.setHeader('Content-Range', 'bytes '+range.start+'-'+range.end+'/'+file.length);

			if (request.method === 'HEAD') return response.end();
			pipeline(client.stream(i, range), response);
			return;
		}

		response.end(JSON.stringify({
			prioritized: client.missing(10),
			list: client.select.list,
			speed: client.speed(),
			downloaded: client.swarm.downloaded,
			uploaded: client.swarm.uploaded,
			streams: client.streams.length,
			queued: client.swarm.queued,
			wires: client.wires.map(function(wire) {
				return {
					address: wire.remoteAddress,
					speed: wire.speed(),
					downloaded: wire.downloaded,
					uploaded: wire.uploaded,
					peerChoking: wire.peerChoking,
					choking: wire.choking
				};
			}),
			files: client.files.map(function(file, i) {
				return {
					name: file.name,
					url: 'http://localhost:8888/'+i
				};
			})
		}));
	});

	server.listen(8888);
	console.log('listening on http://localhost:8888');
});
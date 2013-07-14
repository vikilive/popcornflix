var http = require('http');
var numeral = require('numeral');
var peerflix = require('./index');

peerflix(process.argv[2], function(err, client) {
	if (err) throw err;

	var server = http.createServer(function(request, response) {
		request.connection.setTimeout(15*60*1000);

		if (/^\/\d+$/.test(request.url)) {
			var stream = client.stream(parseInt(request.url.slice(1), 10));
			stream.pipe(response);
			response.on('close', function() {
				stream.destroy();
			});
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
					downloaded: wire.downloaded,
					speed: wire.speed()
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
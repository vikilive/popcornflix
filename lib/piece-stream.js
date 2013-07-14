var Readable = require('stream').Readable || require('readable-stream').Readable;

var PieceStream = function(drive, offset, length) {
	if (!(this instanceof PieceStream)) return new PieceStream(drive, offset, length);
	Readable.call(this);
	this.drive = drive;
	this.target = (offset / drive.pieceLength) | 0;
	this.offset = offset - this.target * drive.pieceLength;
	this.missing = length;
	this.reading = false;
	this.waiting = false;
	this.closed = false;
};

PieceStream.prototype.__proto__ = Readable.prototype;

PieceStream.prototype.destroy = function() {
	if (this.closed) return;
	this.push(null);
	this.closed = true;
	this.missing = 0;
	this.emit('close');
};

PieceStream.prototype._read = function() {
	if (this.reading) return;
	if (!this.missing) return;

	if (!this.drive.readable(this.target)) {
		this.waiting = true;
		return;
	}

	var self = this;
	this.waiting = false;
	this.reading = true;
	this.drive.read(this.target++, function(err, buffer) {
		self.reading = false;
		if (err) return self.destroy();

		if (self.offset >= buffer.length) {
			self.offset -= buffer.length;
			return;
		}
		if (self.offset && self.offset < buffer.length) {
			buffer = buffer.slice(self.offset);
			self.offset = 0;
		}

		if (self.missing <= buffer.length) {
			self.push(buffer.slice(0, self.missing));
			self.destroy();
		} else {
			self.push(buffer);
			self.missing -= buffer.length;
		}
	});
};

PieceStream.prototype.update = function() {
	if (!this.waiting) return;
	this._read();
};

module.exports = PieceStream;
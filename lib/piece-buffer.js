var BLOCK_SIZE = 1 << 14;

var BLOCK_BLANK = 0;
var BLOCK_RESERVED = 1;
var BLOCK_WRITTEN = 2;

var noop = function() {};

var Piece = function(length) {
	if (!(this instanceof Piece)) return new Piece(length);

	this.length = length;
	this.flushed = false;
	this.owners = null;
	this.buffer = null;
	this.blocks = null;
	this.blocksWritten = 0;
};

Piece.prototype.__proto__ = process.EventEmitter.prototype;

Piece.prototype.owner = function(i) {
	if (this.flushed) return null;
	if (!this.blocks) this.clear();
	return this.owners[i];
};

Piece.prototype.select = function(owner, force) {
	if (this.flushed) return -1;
	if (!this.blocks) this.clear();
	force = force || noop;
	for (var i = 0; i < this.blocks.length; i++) {
		if ((this.blocks[i] === BLOCK_WRITTEN) || (this.blocks[i] && !force(this.owners[i]))) continue;
		this.blocks[i] = BLOCK_RESERVED;
		this.owners[i] = owner;
		return i * BLOCK_SIZE;
	}
	return -1;
};

Piece.prototype.sizeof = function(offset) {
	return Math.min(BLOCK_SIZE, this.length - offset);
};

Piece.prototype.deselect = function(offset, owner) {
	if (this.flushed) return;
	var i = (offset / BLOCK_SIZE) | 0;
	if (!this.blocks) this.clear();
	if (owner && owner !== this.owners[i]) return;
	if (this.blocks[i] === BLOCK_RESERVED) this.blocks[i] = BLOCK_BLANK;
};

Piece.prototype.clear = function() {
	this.owners = [];
	this.buffer = [];
	this.blocks = new Uint8Array(Math.ceil(this.length / BLOCK_SIZE));
};

Piece.prototype.write = function(offset, buffer) {
	if (this.flushed) return;

	var i = (offset / BLOCK_SIZE) | 0;
	if (!this.blocks) this.clear();
	if (this.blocks[i] === BLOCK_WRITTEN) return;

	this.blocks[i] = BLOCK_WRITTEN;
	this.owners[i] = null;
	this.blocksWritten++;
	this.buffer[i] = buffer;

	return this.blocksWritten === this.blocks.length;
};

Piece.prototype.flush = function() {
	if (this.flushed) return null;
	var result = Buffer.concat(this.buffer, this.length);
	this.flushed = true;
	this.buffer = null;
	this.blocks = null;
	this.owners = null;
	this.blocksWritten = 0;
	return result;
};

module.exports = Piece;

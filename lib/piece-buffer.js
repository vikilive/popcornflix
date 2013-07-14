var BLOCK_SIZE = 1 << 14;

var BLOCK_BLANK = 0;
var BLOCK_RESERVED = 1;
var BLOCK_WRITTEN = 2;

var noop = function() {};

var Piece = function(length) {
	if (!(this instanceof Piece)) return new Piece(length);

	this.owners = null;
	this.length = length;
	this.buffer = null;
	this.blocks = null;
	this.blocksWritten = 0;
	this.progress = 0;
};

Piece.prototype.__proto__ = process.EventEmitter.prototype;

Piece.prototype.owner = function(i) {
	if (!this.blocks) this.clear();
	return this.owners[i];
};

Piece.prototype.select = function(owner, force) {
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
	var i = (offset / BLOCK_SIZE) | 0;
	if (!this.blocks) this.clear();
	if (owner && owner !== this.owners[i]) return;
	if (this.blocks[i] === BLOCK_RESERVED) this.blocks[i] = BLOCK_BLANK;
};

Piece.prototype.clear = function() {
	this.owners = [];
	this.blocks = new Uint8Array(Math.ceil(this.length / BLOCK_SIZE));
};

Piece.prototype.write = function(offset, buffer) {
	var i = (offset / BLOCK_SIZE) | 0;
	if (!this.blocks) this.clear();
	if (this.blocks[i] === BLOCK_WRITTEN) return;
	this.buffer = this.buffer || new Buffer(this.length);
	this.blocks[i] = BLOCK_WRITTEN;
	this.owners[i] = null;
	this.blocksWritten++;
	buffer.copy(this.buffer, offset);

//	var firstBlank = 0;
//	Array.prototype.some.call(this.blocks, function(block) { firstBlank++; return block != BLOCK_WRITTEN });
//	this.progress = Math.min( this.buffer.length, firstBlank * BLOCK_SIZE);
//	this.emit("progress", this.progress);

	return this.blocksWritten === this.blocks.length && this.buffer;
};

Piece.prototype.reset = function() {
	this.buffer = null;
	this.blocks = null;
	this.blocksWritten = 0;
};

module.exports = Piece;

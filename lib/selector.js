var DONE = -1;
var UNUSED = -2;

var next = function(drive, part) {
	while (drive.readable(part) && part < drive.pieces.length) part++;
	return part === drive.pieces.length ? DONE : part;
};

var Selector = function(drive) {
	if (!(this instanceof Selector)) return new Selector(drive);

	this.drive = drive;
	this.pieces = drive.pieces.length;
	this.list = [];
	this.fallback = [];
	this.defaults = [0];

	this.first = 0;

	var self = this;
	drive.on('readable', function() {
		var map = function(part) {
			return part < 0 ? part : next(self.drive, part);
		};

		self.list = self.list.map(map);
		self.fallback = self.fallback.map(map);
		self.defaults = self.defaults.map(map);
	});
};

Selector.prototype.prioritize = function(part) {
	var self = this;
	var i = this.list.indexOf(UNUSED);
	if (i === -1) i = this.list.length;
	this.list[i] = next(this.drive, part);
	return function() {
		var val = self.list[i];
		self.list[i] = UNUSED;
		while(self.list[self.list.length-1] === UNUSED) self.list.pop();
		if (!self.list.length) self.fallback[0] = val;
	};
};

Selector.prototype.grap = function(num) {
	var result = [];
	var first = this.first;
	this.next(function(i) {
		result.push(i);
		return num-- === 0;
	});
	this.first = first;
	return result;
};

Selector.prototype.next = function(fn) {
	var self = this;
	var select = function(list) {
		if (!list.length) return false;
		var i = self.first % list.length;

		while ((self.first = i) < list.length) {
			var part = list[i++];
			if (part < 0) continue;
			if (fn(part)) return true;
			if (i < list.length) continue;
			i = 0;
			list = list.map(function(part) {
				return part < 0 ? part : next(self.drive, part+1);
			});
		}

		return false;
	};

	select(this.list) || select(this.fallback) || select(this.defaults);
};

module.exports = Selector;
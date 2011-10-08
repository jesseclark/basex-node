// baseXclient
// command queue has {string,parser,callback}
// can set this to true to enable for all connections
exports.debug_mode = false;

var net = require("net")
, util = require("util")
, events = require("events")
, crypto = require("crypto")
, assert = require('assert')
, Queue = require("./lib/queue").Queue;

var states = {
	DISCONNECTED : 0,
	CONNECTING : 1,
	AUTHORIZE : 2,
	CONNECTED : 3,
	CLOSING : 4
};

var CHR0 = "\x00";

var BaseXStream = function(host, port, username, password) {
	var self = this;
	this.port = port || 1984;
	this.host = host || "127.0.0.1";
	this.username = username || "admin";
	this.password = password || "admin";
	this.connections = 0;
	this.attempts = 1;

	this.commands_sent = 0;
	this.retry_delay = 250;
	this.retry_backoff = 1.7;
	this.subscriptions = false;
	this.current_cmd=null;
	this.reset = function() {
		this.state = states.DISCONNECTED;
		this.closefn=null;
		this.buffer = "";
		this.command_queue = new Queue(); // holds commands to send

		this.parser = function() {
			var timestamp = self.readline();
			self.send(self.username);
			var s = md5(md5(self.password) + timestamp);
			self.send(s);
		};
	};
	this.reset();
	var stream;
	try {
		stream = net.createConnection(this.port, this.host);
		stream.setEncoding('utf-8');
	} catch (e) {
		throw "Failed to connect to server"
	}
	;
	this.stream = stream;

	stream.on("connect", function() {
		self.state = states.CONNECTING;
		if (exports.debug_mode) {
			console.log("stream connected");
		};
	});

	stream.on("data", function(reply) {
		self.buffer += reply;
		if (exports.debug_mode) {
			console.log("<<");
			console.dir(self.buffer);
		};

		if (self.state == states.CONNECTING) {
			self.parser();
			self.state = states.AUTHORIZE;
		} else if (self.state == states.AUTHORIZE) {
			if (!self.ok())
				throw "Access denied.";
			self.state = states.CONNECTED;
			if (exports.debug_mode) {
				console.log("authorized");
			};
			self.emit("connected", 1);
			self.doNext();
		} else {
			var r=self.getResponse();
			if(r){
				if (exports.debug_mode) {
					console.log("response: ",r);
				};
				if(self.current_command.callback){
					self.current_command.callback(null,r);
				}
				self.current_command=null;
				self.doNext();
			}
		}
	});

	stream.on("error", function(msg) {
		console.log("stream error", msg);
	});

	stream.on("close", function() {
		if (exports.debug_mode) {
			console.log("stream close");
		};
		if(self.closefn){
			self.closefn();
			self.closefn=null;
		};
	});

	stream.on("end", function() {
		//console.log("stream end");
	});

	stream.on("drain", function() {
		// console.log("drain");
	});

	this.send = function(str) {
		if (exports.debug_mode) {
			console.log(">>");
			console.dir(str+ CHR0);
		};
		self.stream.write(str + CHR0);
		self.commands_sent+=1;
	};
	// read 1 character
	this.read = function() {
		// console.log("data", l, p, buffer + ":");
		var ip = self.buffer.substr(0, 1);
		self.buffer = self.buffer.substr(1);
		return ip;
	};
	this.ok=function(){
		return self.read()==CHR0;
	};
	// read upto null
	this.readline = function() {
		var p = self.buffer.indexOf(CHR0);
		assert.notEqual(p, -1, "no null");
		// console.log("data", l, p, buffer + ":");
		var ip = self.buffer.substring(0, p);
		self.buffer = self.buffer.substring(p + 1);
		return ip;
	};
	this.getResponse = function() {
		if (-1 != self.buffer.indexOf(CHR0)) {
			var result=self.readline();
			var info =self.readline();
			var ok=self.ok();
			return {result:result,info:info};
		}
		
	};
	// read line and byte
	this.getResponse2 = function() {
		if (-1 != self.buffer.indexOf(CHR0)) {
			var reply=self.readline();
			var ok=self.ok();
			return {result:reply,ok:ok}
		}
		
	};
	this.readiter = function() {
		console.log("reaqditer");
		if (-1 != self.buffer.indexOf(CHR0)) {			
			var ok=self.ok();
			var reply=self.readline();
			return {result:reply,ok:ok}
		}
		
	};
	// add command and returns the result:
	this.execute = function(cmd, callback) {
        self.send_command({
			send : cmd ,
			parser : self.getResponse,
			callback : callback
		});		
	};
	// Returns a query object for the specified query:
	this.query = function(query) {
		return new Query(self,query);	
	};
	// Creates a database from an input stream:
	this.create = function(name, input,callback) {
		 self.send_command({
				send : "\x08" + name+ CHR0+input,
				parser : self.getResponse2,
				callback : callback
			});		
	};
	// Adds a document to the current database from an input stream:
	this.add = function(name, target, input,callback) {
		 self.send_command({
				send : "\x09" + name + CHR0+target+CHR0+input,
				parser : self.getResponse2,
				callback : callback
			});		
	};
	// Replaces a document with the specified input stream:
	this.replace = function(path, input,callback) {
		 self.send_command({
				send : "\x0C" + path + CHR0+input,
				parser : self.getResponse2,
				callback : callback
			});		
	};
	// Stores raw data at the specified path:
	this.store = function(path, input,callback) {
		 self.send_command({
				send : "\x0D" + path + CHR0+input,
				parser : self.getResponse2,
				callback : callback
			});		
	};
	// watch
	this.watch = function(name,callback) {
		throw "@TODO watch";
		 self.send_command({
				send : "\x0A"+name,
				parser : self.getResponse,
				callback : callback
			});		
	};
	// unwatch
	this.unwatch = function(name,callback) {
		throw "@TODO unwatch";
		 self.send_command({
				send : "\x0B" + name,
				parser : self.getResponse,
				callback : callback
			});		
	};
	// end the session, sash callback, for stream end
	this.close = function(callback) {
		self.closefn=callback;
		 self.send_command({
				send : "exit" + CHR0,
				parser : self.getResponse,
			});		
	};
	// -------end of commands ---------
	
	// 
	this.send_command=function(cmd){
		self.command_queue.push(cmd);
		if(self.state==states.CONNECTED && !self.current_command){
		 self.doNext();
		}
	};
	// do the next queued command, if any
    this.doNext=function(){
    	if(self.command_queue.length==0)return
    	self.current_command=self.command_queue.shift();
    	var s=self.current_command.send;
    	if(typeof s === "function"){
    		s=s();
    	};
    	assert.equal(self.buffer.length,0,"buffer not empty:"+self.buffer);
    	self.send(s);
    };
	events.EventEmitter.call(this);
};

//query
// send is function as needs id 
var Query = function(session,query){
	this.session=session;
	this.query=query;
	this.id=null;
	var self=this;
	
    this.close=function(callback){
		self.session.send_command({
			send:function(){return "\x02"+ self.id},
		    parser:self.session.getResponse2,
		    callback:callback
		});
    };
    
	this.bind=function(name,value,type,callback){
		var type="";
		self.session.send_command({
			send:function(){
				return "\x03"+ self.id +"\x00"+name+"\x00"+value+"\x00"+type
			},
		    parser:self.session.getResponse2,
		    callback:callback
		});
		 
	};
	
	this.iter=function(callback){
		self.session.send_command({
			send:function(){return "\x04"+ self.id},
		    parser:self.session.readiter,
		    callback:callback
		});
    };
    
	this.execute=function(callback){
		self.session.send_command({
			send: function(){return "\x05"+ self.id},
		    parser:self.session.getResponse2,
		    callback:callback
		});
    };

	this.info=function(callback){
		self.session.send_command({
			send:function(){return "\x06"+ self.id},
		    parser:self.session.getResponse2,
		    callback:callback
		});
    };

	this.options=function(callback){
		self.session.send_command({
			send: function(){return "\x07"+ self.id},
		    parser:self.session.getResponse2,
		    callback:callback				
		});
    };

	// request id
	session.send_command({
			send : CHR0+query ,
			parser : self.session.getResponse2,
			callback : function(err,reply){
				self.id=reply.result;
				if (exports.debug_mode) {
					console.log("Query id: ",self.id,", query: ",query);
				};
			}
	});		
};


function md5(str) {
	return crypto.createHash('md5').update(str).digest("hex");
};

util.inherits(BaseXStream, events.EventEmitter);
exports.Session = BaseXStream;
// debug util
function print(err, reply) {
	if (err) {
		console.log("Error: " + err);
	} else {
		console.dir(reply);
	}
};
exports.print = print;
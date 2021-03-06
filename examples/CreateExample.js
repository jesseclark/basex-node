/*
 * This example shows how new databases can be created.
 *
 */
var basex = require("../index");
var log = require("../debug");
//basex.debug_mode = true;
// create session
var client = new basex.Session("localhost", 1984, "admin", "admin");

// create new database
client.create("database", "<x>Hello World!</x>", log.print);

// run query on database
client.execute("xquery /", log.print);

// drop database
client.execute("drop db database", log.print);

// close session
client.close();

#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2));
var columnify = require("columnify");
var cp = require("child_process");
var fs = require("fs");
var path = require("path");
var walk = require("walk");

var help = `box-js is a utility to analyze malicious JavaScript files.

Usage:
    box-js <files|directories> [args]

Arguments:
`;

// Read and format JSON flag documentation
var flags = JSON.parse(fs.readFileSync(path.join(__dirname, 'flags.json'), 'utf8'));
flags = columnify(flags, {
    showHeaders: false,
    config: {
        description: {
            maxWidth: 50
        }
    }
});

if (argv.h || argv.help || argv.length === 0) {
    console.log(help + flags.replace(/^/mg, "    "));
    process.exit(0);
}

let timeout = argv.timeout || 10;
if (!argv.timeout)
	console.log("Using a 10 seconds timeout, pass --timeout to specify another timeout in seconds");

let outputDir = argv["output-dir"] || "./";

const isFile = path => {
	try {
		fs.statSync(path);
		return true;
	} catch (e) {
		return false;
	}
};

const options = process.argv
	.slice(2)
	.filter(path => !isFile(path));

const tasks = process.argv
	.slice(2)
	.filter(isFile)
	.map(path => fs.statSync(path).isDirectory() ?
		cb => {
			let files = [];
			walk.walkSync(path, {
				listeners: {
					file: (root, stat, next) => {
						files.push({root, name: stat.name});
						next();
					}
				}
			});
			return files.map(
				({root, name}) => analyze(root + name, name, outputDir)
			);
		} :
		() => analyze(path, path, outputDir)
	);

if (tasks.length === 0) {
	console.log("Please pass one or more filenames or directories as an argument.");
	process.exit(-1);
}

// Prevent "possible memory leak" warning
process.setMaxListeners(Infinity);

tasks.forEach(task => task());

function isDir(path) {
	try {
		return fs.statSync(path).isDirectory();
	} catch (e) {
		return false;
	}
}

function analyze(file_path, filename, outputDir) {
	let directory = path.join(outputDir, filename + ".results");
	let i = 1;
	while (isDir(directory)) {
		i++;
		directory = path.join(outputDir, filename + "." + i + ".results");
	}
	fs.mkdirSync(directory);
	directory += "/"; // For ease of use
	let worker = cp.fork(path.join(__dirname, 'analyze'), [file_path, directory, ...options]);
	let killTimeout;

	worker.on('message', function(data) {
		clearTimeout(killTimeout);
		worker.kill();
	});

	worker.on('exit', function(code, signal) {
		if (code === 1) {
			console.log(`
 * If you see garbled text, try emulating Windows XP with --windows-xp.
 * If the error is about a weird \"Unknown ActiveXObject\", try --no-kill.
 * If the error is about a legitimate \"Unknown ActiveXObject\", report a bug at https://github.com/CapacitorSet/box-js/issues/ .`);
		}
		clearTimeout(killTimeout);
		worker.kill();
		if (argv.debug) process.exit(-1);
	});

	worker.on('error', function(err) {
		console.log("weee");
		console.log(err);
		clearTimeout(killTimeout);
		worker.kill();
	});

	killTimeout = setTimeout(function killOnTimeOut() {
		console.log(`Analysis for ${filename} timed out.`);
		worker.kill();
	}, timeout * 1000);

	process.on('exit', () => worker.kill());
	process.on('SIGINT', () => worker.kill());
	// process.on('uncaughtException', () => worker.kill());
}

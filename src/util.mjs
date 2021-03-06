import {Registry} from './Registry.mjs'
import cp from 'child_process'
import {SZ, MULTI_SZ, EXPAND_SZ, DWORD, QWORD, BINARY, NONE} from './constants.mjs'


let ERR_MSG_NOT_FOUND = 'ERROR: The system was unable to find the specified registry key or value.'
let errorMessageDetectionPromise

const stdio = ['ignore', 'pipe', 'pipe']


function promiseOnce(eventEmitter, event) {
	return new Promise(resolve => eventEmitter.once(event, resolve))
}


// Promise wrapper for child_process.spawn().
var spawnProcess = async args => {
	var proc = cp.spawn('reg.exe', args, {stdio})

	var stdout = ''
	var stderr = ''
	proc.stdout.on('data', data => stdout += data.toString())
	proc.stderr.on('data', data => stderr += data.toString())

	//var code = await promiseOnce(proc, 'exit')
	var code = await promiseOnce(proc, 'close')

	proc.removeAllListeners()

	//proc.on('error', err => {
	//	console.error('process error', err)
	//	reject(err)
	//	proc.removeAllListeners()
	//})

	return {stdout, stderr, code}
}

// Replaces default spawnProcess() that uses Node's child_process.spawn().
export function _replaceProcessSpawner(externalHook) {
	spawnProcess = externalHook
}

export async function execute(args) {
	var {stdout, stderr, code} = await spawnProcess(args)

	// REG command has finished running, resolve result or throw error if any occured.
	if (stderr.length) {
		var line = stderr.trim().split('\r\n')[0]
		if (line === ERR_MSG_NOT_FOUND) {
			// Return undefined if the key path does not exist.
			return undefined
		} else {
			// Propagate the error forward.
			var message = `${line.slice(7)} - Command 'reg ${args.join(' ')}'`
			var err = new Error(message)
			delete err.stack
			throw err
		}
	} else {
	//} else if (code === 0) {
		return stdout
	}
}


export function inferAndStringifyData(data, type) {
	if (data === undefined || data === null)
		return [data, type]
	switch (data.constructor) {
		// Convert Buffer data into string and infer type to REG_BINARY if none was specified.
		case Uint8Array:
			data = data.buffer
		case ArrayBuffer:
			data = Buffer.from(data)
		case Buffer:
			if (type === undefined)
				type = BINARY
			// Convert to ones and zeroes if the type is REG_BINARY or fall back to utf8.
			data = data.toString(type === BINARY ? 'hex' : 'utf8')
			break
		case Array:
			// Set REG_MULTI_SZ type if none is specified.
			if (type === undefined)
				type = MULTI_SZ
			// REG_MULTI_SZ contains a string with '\0' separated substrings.
			data = data.join('\\0')
			break
		case Number:
			// Set REG_DWORD type if none is specified.
			if (type === undefined)
				type = DWORD
			break
		case String:
		//default:
			// Set REG_SZ type if none is specified.
			switch (type) {
				case BINARY:
					data = Buffer.from(data, 'utf8').toString('hex')
					break
				case MULTI_SZ:
					data = data.replace(/\0/g, '\\0')
					break
				case undefined:
					type = SZ
					break
			}
	}
	return [data, type]
}

export function parseValueData(data, type) {
	if (type === BINARY)
		data = Buffer.from(data, 'hex')
	if (type === DWORD)
		data = parseInt(data)
	//if (type === QWORD && convertQword)
	//	data = parseInt(data)
	if (type === MULTI_SZ)
		data = data.split('\\0')
	return [data, type]
}

// Transforms possible forwardslashes to Windows style backslash
export function sanitizePath(path) {
	path = path.trim()
	if (path.includes('/'))
		return path.replace(/\//g, '\\')
	else
		return path
}

// Uppercases and prepends 'REG_' to a type string if needed.
export function sanitizeType(type) {
	// Skip transforming if the type is undefined
	if (type === undefined)
		return
	type = type.toUpperCase()
	// Prepend REG_ if it's missing
	if (!type.startsWith('REG_'))
		type = 'REG_' + type
	return type
}

export function getOptions(userOptions) {
	var {lowercase, format} = Registry
	var defaultOptions = {lowercase, format}
	if (userOptions)
		return Object.assign(defaultOptions, userOptions)
	else
		return defaultOptions
}

async function _detectErrorMessagesInternal () {
	var {stderr} = await spawnProcess(['QUERY', 'HKLM\\NONEXISTENT'])
	ERR_MSG_NOT_FOUND = stderr.trim().split('\r\n')[0]
}

export function detectErrorMessages () {
	// ensure we run this only once
	if (!errorMessageDetectionPromise) {
		errorMessageDetectionPromise = _detectErrorMessagesInternal()
	}
	return errorMessageDetectionPromise
}

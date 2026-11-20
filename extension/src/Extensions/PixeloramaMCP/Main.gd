extends Node
## Listens on localhost for the pixelorama-mcp server.
## The protocol is one JSON object per line: {"id", "method", "params"} in,
## {"id", "result"} or {"id", "error"} out.

const PORT := 7651
const MAX_LINE_BYTES := 16 << 20
const Commands := preload("commands.gd")


class Client:
	var peer: StreamPeerTCP
	var buffer := PackedByteArray()


var _server := TCPServer.new()
var _clients: Array[Client] = []
var _commands: Commands
var _build_info: Dictionary


func _ready() -> void:
	# Pixelorama pauses itself when its window loses focus, which is exactly
	# when an agent is talking to it.
	process_mode = Node.PROCESS_MODE_ALWAYS
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(
		"res://src/Extensions/PixeloramaMCP/extension.json"
	))
	_build_info = {
		"version": manifest.get("version"),
		"editor_version": Global.current_version,
		"build": manifest.get("build"),
		"profile": ProjectSettings.globalize_path("user://").trim_suffix("/"),
	}
	_commands = Commands.new(get_node("/root/ExtensionsApi"))
	var err := _server.listen(PORT, "127.0.0.1")
	if err != OK:
		push_error("Pixelorama MCP: cannot listen on port %d: %s" % [PORT, error_string(err)])


func _exit_tree() -> void:
	for client in _clients:
		client.peer.disconnect_from_host()
	_clients.clear()
	_server.stop()


func _process(_delta: float) -> void:
	while _server.is_connection_available():
		var client := Client.new()
		client.peer = _server.take_connection()
		_clients.append(client)

	for client: Client in _clients.duplicate():
		client.peer.poll()
		if client.peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			_clients.erase(client)
			continue
		var available := client.peer.get_available_bytes()
		if available > 0:
			client.buffer.append_array(client.peer.get_data(available)[1])
			_read_lines(client)


func _read_lines(client: Client) -> void:
	while true:
		var newline := client.buffer.find(10)
		if newline == -1:
			if client.buffer.size() > MAX_LINE_BYTES:
				_drop(client)
			return

		var line := client.buffer.slice(0, newline).get_string_from_utf8()
		client.buffer = client.buffer.slice(newline + 1)
		var json := JSON.new()
		if json.parse(line) != OK or not json.data is Dictionary:
			# Anything that doesn't speak the protocol, like a browser sending an
			# HTTP request to this port, gets disconnected before it can do anything.
			_drop(client)
			return

		var msg: Dictionary = json.data
		var params = msg.get("params", {})
		var method := str(msg.get("method", ""))
		var result
		match method:
			"extension_status":
				result = _build_info
			"extension_disable":
				result = _disable_extension()
			_:
				result = _commands.run(method, params if params is Dictionary else {})
		if not result is Dictionary:
			# Release builds of Pixelorama abort a failing script call without
			# printing anything, so this is the only sign that something broke.
			result = {"error": "The command failed inside Pixelorama"}
		var reply := {"id": msg.get("id")}
		if result.has("error"):
			reply.error = result.error
		else:
			reply.result = result
		client.peer.put_data((JSON.stringify(reply) + "\n").to_utf8_buffer())


func _drop(client: Client) -> void:
	client.peer.disconnect_from_host()
	_clients.erase(client)


func _disable_extension() -> Dictionary:
	var handler = get_parent()
	var extension = handler.extensions.get("PixeloramaMCP.zip")
	if not extension or extension.file_name != "PixeloramaMCP":
		return {"error": "Cannot locate PixeloramaMCP in the extension manager"}
	var cache := Global.config_cache
	var previous = cache.get_value("extensions", "PixeloramaMCP", true)
	cache.set_value("extensions", "PixeloramaMCP", false)
	var err := cache.save(Global.CONFIG_PATH)
	if err != OK:
		cache.set_value("extensions", "PixeloramaMCP", previous)
		return {"error": "Cannot save the PixeloramaMCP preference: %s" % error_string(err)}
	extension.enabled = false
	# Reply first, then let Pixelorama detach our node and disconnect its clients.
	handler.enable_extension.call_deferred(extension, false)
	return {"disabled": true}

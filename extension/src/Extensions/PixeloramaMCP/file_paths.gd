extends RefCounted
## Optional, per-profile restriction for requests that use the local filesystem.

const CONFIG_PATH := "user://pixelorama-mcp.json"

var root := ""
var config_error := ""
var windows := OS.get_name() == "Windows"


func _init() -> void:
	if not FileAccess.file_exists(CONFIG_PATH):
		return
	var config = JSON.parse_string(FileAccess.get_file_as_string(CONFIG_PATH))
	if config is Dictionary and config.get("root") is String:
		root = _absolute(config.root)
	if root.is_empty() or not DirAccess.dir_exists_absolute(root) or _has_link(root):
		config_error = "pixelorama-mcp.json must set root to an existing absolute folder without links"


func status() -> String:
	if not config_error.is_empty():
		return "invalid"
	return "off" if root.is_empty() else root


func check(path: String) -> Dictionary:
	if not config_error.is_empty():
		return {"error": config_error}
	if root.is_empty():
		return {"path": path}

	var resolved := _absolute(path)
	var prefix := root if root.ends_with("/") else root + "/"
	var comparable := resolved.to_lower() if windows else resolved
	var allowed := prefix.to_lower() if windows else prefix
	if comparable.begins_with(allowed) and resolved.length() > prefix.length():
		# Use the configured spelling for the root even on case-sensitive Windows directories.
		resolved = prefix + resolved.substr(prefix.length())
		if not _has_link(resolved):
			return {"path": resolved}
	return {"error": "Path outside the allowed folder: %s" % root}


func _absolute(path: String) -> String:
	if windows:
		path = path.replace("\\", "/")
		if path.length() < 3 or not path[0].to_lower() in "abcdefghijklmnopqrstuvwxyz" or path.substr(1, 2) != ":/":
			return ""
		for component in path.substr(3).split("/", false):
			if component in [".", ".."]:
				continue
			if component.contains(":") or component.ends_with(".") or component.ends_with(" "):
				return ""
	elif not path.begins_with("/") or path.contains("\\"):
		return ""
	var clean := path.simplify_path()
	var volume_length := 3 if windows else 1
	while clean.length() > volume_length and clean.ends_with("/"):
		clean = clean.trim_suffix("/")
	return clean


func _has_link(path: String) -> bool:
	var volume_length := 3 if windows else 1
	var prefix := path.left(volume_length)
	var fs := DirAccess.open(prefix)
	if fs == null:
		return true
	for component in path.substr(volume_length).split("/", false):
		prefix = prefix.path_join(component)
		if fs.is_link(prefix):
			return true
	return false

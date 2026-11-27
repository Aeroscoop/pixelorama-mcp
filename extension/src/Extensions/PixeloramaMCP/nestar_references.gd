extends RefCounted

const GROUP_NAME := "Nestar references"
const ROLE := &"pixelorama_mcp_nestar_reference"
const DEFAULT_CANVAS := Vector2i(112, 216)
## Layer names for Nestar's demo ids; other ids use names from the data or their own id.
const NAMES := {"diertje": "Diertje", "sterrenpot": "Sterrenpot", "pakje": "Pakje", "brief": "Brief"}


## data: {version: 1, day: {id: asset}, night: {id: asset}} plus optional
## canvas {width, height} (default 112 × 216), names {id: layer name} and group.
## Nestar's four demo assets are the default, but any set of 1–16 ids works.
static func load_into(project: Project, data: Variant, day: int, night: int) -> Dictionary:
	if project.is_indexed():
		return {"error": "Reference layers require an RGBA sketch to preserve exact colors and alpha"}
	if not data is Dictionary or data.get("version") != 1:
		return {"error": "Expected reference data version 1"}
	var canvas := DEFAULT_CANVAS
	if data.has("canvas"):
		var c = data.canvas
		if not c is Dictionary or not _whole(c.get("width"), 1, 4096) or not _whole(c.get("height"), 1, 4096):
			return {"error": "canvas must have a whole width and height from 1 to 4096"}
		canvas = Vector2i(int(c.width), int(c.height))
	if Vector2i(project.size) != canvas:
		return {"error": "These references need a %d × %d canvas; the project is %d × %d" % [canvas.x, canvas.y, project.size.x, project.size.y]}
	var day_data = data.get("day")
	var night_data = data.get("night")
	if not day_data is Dictionary or not night_data is Dictionary or day_data.is_empty() or day_data.size() > 16:
		return {"error": "day and night must each hold 1–16 references"}
	var ids: Array = day_data.keys()
	var night_ids: Array = night_data.keys()
	ids.sort()
	night_ids.sort()
	if ids != night_ids:
		return {"error": "day and night must contain the same reference ids"}
	ids = day_data.keys()
	var names = data.get("names", {})
	if not names is Dictionary:
		return {"error": "names must map reference ids to layer names"}
	var group_name = data.get("group", GROUP_NAME)
	if not group_name is String or group_name.strip_edges().is_empty():
		return {"error": "group must be a non-empty name"}

	var content := {}
	var layer_names := {}
	var assets := []
	for id in ids:
		if not id is String or id.is_empty():
			return {"error": "Reference ids must be non-empty strings"}
		var textures := []
		for period_data in [day_data, night_data]:
			var decoded := _decode_asset(period_data[id], project.size)
			if decoded.is_empty():
				return {"error": "Invalid %s reference in %s" % [id, "day" if period_data == day_data else "night"]}
			textures.append(decoded)
		content[id] = textures
		var label = names.get(id, NAMES.get(id, id.capitalize()))
		layer_names[id] = str(label)
		var image: Image = textures[0][0]
		var origin: Vector2i = textures[0][1]
		assets.append({"id": id, "name": layer_names[id], "x": origin.x, "y": origin.y,
			"width": image.get_width(), "height": image.get_height()})

	var groups := project.layers.filter(func(layer): return layer.get_meta(ROLE, "") == "group")
	if groups.size() > 1:
		return {"error": "Multiple reference groups exist in this project"}
	var change: Dictionary
	if groups.is_empty():
		change = _add_group(project, content, layer_names, group_name.strip_edges(), [day, night])
	else:
		change = _update_group(project, groups[0], content, [day, night])
	if change.has("error"):
		return change
	change.assets = assets
	return change


static func _whole(value: Variant, minimum: int, maximum: int) -> bool:
	return (value is int or value is float) and value >= minimum and value <= maximum and int(value) == value


static func _decode_asset(asset: Variant, size: Vector2i) -> Array:
	if not asset is Dictionary or not asset.get("rgba") is String:
		return []
	for field in ["x", "y", "width", "height"]:
		var value = asset.get(field)
		if not (value is int or value is float) or not (value >= 0 and value <= maxi(size.x, size.y)) or int(value) != value:
			return []
	var origin := Vector2i(int(asset.x), int(asset.y))
	var dimensions := Vector2i(int(asset.width), int(asset.height))
	if dimensions.x <= 0 or dimensions.y <= 0 or not Rect2i(Vector2i.ZERO, size).encloses(Rect2i(origin, dimensions)):
		return []
	var expected := dimensions.x * dimensions.y * 4
	if asset.rgba.length() != 4 * ceili(expected / 3.0):
		return []
	var pixels := Marshalls.base64_to_raw(asset.rgba)
	if pixels.size() != expected:
		return []
	var image := Image.create_from_data(dimensions.x, dimensions.y, false, Image.FORMAT_RGBA8, pixels)
	return [ImageExtended.create_from_image(image), origin]


static func _add_group(project: Project, content: Dictionary, layer_names: Dictionary, group_name: String, frames: Array) -> Dictionary:
	var group := GroupLayer.new(project, group_name)
	group.set_meta(ROLE, "group")
	var children := []
	var indices := PackedInt32Array()
	var cels := []
	var start := project.layers.size()
	for id in content:
		var child := PixelLayer.new(project, layer_names[id])
		child.parent = group
		child.locked = true
		child.set_meta(ROLE, id)
		indices.append(start + children.size())
		children.append(child)
		var layer_cels := _create_cels(child, project.frames.size())
		for i in frames.size():
			layer_cels[frames[i]].set_content(content[id][i])
		cels.append(layer_cels)
	var all_indices := indices.duplicate()
	all_indices.append(start + children.size())
	var selection := project.selected_cels.duplicate(true)
	var restore_cel := project.change_cel.bind(project.current_frame, project.current_layer)
	var history := project.undo_redo
	history.create_action("MCP load_nestar_references")
	history.add_do_method(project.add_layers.bind([group], PackedInt32Array([start]), [_create_cels(group, project.frames.size())]))
	history.add_do_method(project.add_layers.bind(children, indices, cels))
	history.add_undo_method(project.remove_layers.bind(all_indices))
	history.add_do_property(project, "selected_cels", selection.duplicate(true))
	history.add_undo_property(project, "selected_cels", selection.duplicate(true))
	# Layer mutations clear selection and leave the renderer's layer order stale.
	history.add_do_method(restore_cel)
	history.add_undo_method(restore_cel)
	_finish_history(history)
	return {"group": group.name, "changed": true}


static func _create_cels(layer: BaseLayer, count: int) -> Array:
	var cels := []
	for i in count:
		cels.append(layer.new_empty_cel())
	return cels


static func _update_group(project: Project, group: BaseLayer, content: Dictionary, frames: Array) -> Dictionary:
	var edits := []
	var existing := group.get_children(false).map(func(layer): return layer.get_meta(ROLE, ""))
	existing.sort()
	var wanted: Array = content.keys()
	wanted.sort()
	if existing != wanted:
		return {"error": "The reference group '%s' holds other references than this data. Remove the group to load a different set." % group.name}
	for id in content:
		var matches := group.get_children(false).filter(func(layer): return layer.get_meta(ROLE, "") == id)
		if matches.size() != 1 or not matches[0] is PixelLayer:
			return {"error": "Missing or duplicated reference layer: %s" % id}
		for i in frames.size():
			var cel: PixelCel = project.frames[frames[i]].cels[matches[0].index]
			if cel.link_set != null and cel.link_set.size() > 1:
				return {"error": "Unlink the reference cel before refreshing: %s" % id}
			var next: Array = content[id][i]
			if cel.offset != next[1] or cel.image.get_size() != next[0].get_size() or cel.image.get_data() != next[0].get_data():
				edits.append([cel, next])
	if edits.is_empty():
		return {"group": group.name, "changed": false}
	var history := project.undo_redo
	history.create_action("MCP load_nestar_references")
	for edit in edits:
		history.add_do_method(edit[0].set_content.bind(edit[1]))
		history.add_undo_method(edit[0].set_content.bind(edit[0].get_content()))
	_finish_history(history)
	return {"group": group.name, "changed": true}


static func _finish_history(history: UndoRedo) -> void:
	history.add_do_method(Global.undo_or_redo.bind(false))
	history.add_undo_method(Global.undo_or_redo.bind(true))
	history.commit_action()

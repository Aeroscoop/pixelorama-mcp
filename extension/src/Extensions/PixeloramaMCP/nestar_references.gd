extends RefCounted

const GROUP_NAME := "Nestar references"
const ROLE := &"pixelorama_mcp_nestar_reference"
const NAMES := {"diertje": "Diertje", "sterrenpot": "Sterrenpot", "pakje": "Pakje", "brief": "Brief"}


static func load_into(project: Project, data: Variant, day: int, night: int) -> Dictionary:
	if project.is_indexed():
		return {"error": "Nestar references require an RGBA sketch to preserve exact colors and alpha"}
	if not data is Dictionary or data.get("version") != 1:
		return {"error": "Expected Nestar reference data version 1"}
	var content := {}
	var assets := []
	for id in NAMES:
		var textures := []
		for period in ["day", "night"]:
			var period_data = data.get(period)
			var asset = period_data.get(id) if period_data is Dictionary else null
			var decoded := _decode_asset(asset, project.size)
			if decoded.is_empty():
				return {"error": "Invalid %s reference in %s" % [id, period]}
			textures.append(decoded)
		content[id] = textures
		var image: Image = textures[0][0]
		var origin: Vector2i = textures[0][1]
		assets.append({"id": id, "name": NAMES[id], "x": origin.x, "y": origin.y,
			"width": image.get_width(), "height": image.get_height()})

	var groups := project.layers.filter(func(layer): return layer.get_meta(ROLE, "") == "group")
	if groups.size() > 1:
		return {"error": "Multiple Nestar reference groups exist in this project"}
	var change: Dictionary
	if groups.is_empty():
		change = _add_group(project, content, [day, night])
	else:
		change = _update_group(project, groups[0], content, [day, night])
	if change.has("error"):
		return change
	change.assets = assets
	return change


static func _decode_asset(asset: Variant, size: Vector2i) -> Array:
	if not asset is Dictionary or not asset.get("rgba") is String:
		return []
	for field in ["x", "y", "width", "height"]:
		var value = asset.get(field)
		if not (value is int or value is float) or not (value >= 0 and value <= size.y) or int(value) != value:
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


static func _add_group(project: Project, content: Dictionary, frames: Array) -> Dictionary:
	var group := GroupLayer.new(project, GROUP_NAME)
	group.set_meta(ROLE, "group")
	var children := []
	var indices := PackedInt32Array()
	var cels := []
	var start := project.layers.size()
	for id in NAMES:
		var child := PixelLayer.new(project, NAMES[id])
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
	for id in NAMES:
		var matches := group.get_children(false).filter(func(layer): return layer.get_meta(ROLE, "") == id)
		if matches.size() != 1 or not matches[0] is PixelLayer:
			return {"error": "Missing or duplicated Nestar reference layer: %s" % NAMES[id]}
		for i in frames.size():
			var cel: PixelCel = project.frames[frames[i]].cels[matches[0].index]
			if cel.link_set != null and cel.link_set.size() > 1:
				return {"error": "Unlink the reference cel before refreshing: %s" % NAMES[id]}
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

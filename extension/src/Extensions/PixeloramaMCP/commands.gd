extends RefCounted
## The commands the MCP server can run. Each one takes the request params and
## returns a Dictionary; failures return {"error": "..."}.
##
## Pixelorama counts frames from left to right and layers from bottom to top,
## both starting at 0. Drawing goes through ExtensionsApi.project.set_pixelcel_image,
## so every change is a single undo step in Pixelorama.

const LAYER_TYPES := ["pixel", "group", "3d", "tilemap", "audio"]
const MAX_READ_PIXELS := 128 * 128
## Characters used to label colors in read_pixels. "." is reserved for transparent.
const SYMBOLS := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@$%&*+=-~^<>?!:;/|"

var api: Node


func _init(extensions_api: Node) -> void:
	api = extensions_api


func run(method: String, params: Dictionary) -> Dictionary:
	var command := "_cmd_" + method
	if method.is_empty() or not has_method(command):
		return _error("Unknown method: %s" % method)
	return call(command, params)


func _cmd_get_project(_params: Dictionary) -> Dictionary:
	var global = api.general.get_global()
	var project = global.current_project
	var open_projects := []
	for p in global.projects:
		open_projects.append(p.name)
	return {
		"name": project.name,
		"width": project.size.x,
		"height": project.size.y,
		"frames": project.frames.size(),
		"fps": project.fps,
		"layers": _layer_entries(project),
		"current_frame": project.current_frame,
		"current_layer": project.current_layer,
		"save_path": project.save_path,
		"color_mode": "indexed" if project.is_indexed() else "rgba",
		"palette": _current_palette_name(),
		"open_projects": open_projects,
	}


func _cmd_get_drawing_settings(_params: Dictionary) -> Dictionary:
	var global = api.general.get_global()
	return {"show_grid": global.draw_grid, "show_pixel_grid": global.draw_pixel_grid}


func _cmd_set_drawing_settings(params: Dictionary) -> Dictionary:
	for key in params:
		if key not in ["show_grid", "show_pixel_grid"] or not params[key] is bool:
			return _error("Expected boolean show_grid or show_pixel_grid")
	var global = api.general.get_global()
	if params.has("show_grid") and global.draw_grid != params.show_grid:
		global.top_menu_container._toggle_show_grid()
	if params.has("show_pixel_grid") and global.draw_pixel_grid != params.show_pixel_grid:
		global.top_menu_container._toggle_show_pixel_grid()
	return _cmd_get_drawing_settings({})


func _layer_entry(project, index: int) -> Dictionary:
	var layer = project.layers[index]
	return {
		"index": index,
		"name": layer.name,
		"type": LAYER_TYPES[layer.get_layer_type()],
		"visible": layer.visible,
		"visible_in_hierarchy": layer.is_visible_in_hierarchy(),
		"parent_index": layer.parent.index if is_instance_valid(layer.parent) else null,
		"locked": layer.locked,
	}


func _layer_entries(project) -> Array:
	var entries := []
	for index in project.layers.size():
		entries.append(_layer_entry(project, index))
	return entries


func _cmd_list_layers(_params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	return {
		"project": project.name,
		"current_layer": project.current_layer,
		"layers": _layer_entries(project),
	}


func _cmd_set_layer_visibility(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var name = params.get("name")
	var visible = params.get("visible")
	if typeof(name) != TYPE_STRING or name.is_empty():
		return _error("A layer name is required")
	if typeof(visible) != TYPE_BOOL:
		return _error("visible must be a boolean")

	var index := -1
	if params.has("index"):
		var requested = params.index
		if typeof(requested) not in [TYPE_INT, TYPE_FLOAT] or requested != floor(requested):
			return _error("index must be an integer")
		index = int(requested)
		if index < 0 or index >= project.layers.size() or project.layers[index].name != name:
			return _error("No layer named '%s' at index %d; list the layers again" % [name, index])
	else:
		for candidate in project.layers.size():
			if project.layers[candidate].name != name:
				continue
			if index != -1:
				return _error("Multiple layers are named '%s'; use list_layers and pass index" % name)
			index = candidate
		if index == -1:
			return _error("Layer '%s' does not exist" % name)

	var selected_layer = project.layers[index]
	var changed: bool = selected_layer.visible != visible
	if changed:
		var global = api.general.get_global()
		var history = project.undo_redo
		history.create_action("MCP layer visibility")
		history.add_do_property(selected_layer, "visible", visible)
		history.add_undo_property(selected_layer, "visible", selected_layer.visible)
		history.add_do_method(_refresh_layer_visibility.bind(global))
		history.add_undo_method(_refresh_layer_visibility.bind(global))
		history.add_do_method(global.undo_or_redo.bind(false))
		history.add_undo_method(global.undo_or_redo.bind(true))
		history.commit_action()
	return {"project": project.name, "changed": changed, "layer": _layer_entry(project, index)}


func _refresh_layer_visibility(global) -> void:
	global.canvas.update_all_layers = true
	global.canvas.queue_redraw()
	global.animation_timeline.update_layer_expanded_status()
	global.animation_timeline.update_global_layer_buttons()


func _cmd_new_project(params: Dictionary) -> Dictionary:
	var width := int(params.get("width", 64))
	var height := int(params.get("height", 64))
	if width < 1 or height < 1 or width > 4096 or height > 4096:
		return _error("Size must be between 1 and 4096 pixels")
	# new_project() only accepts a typed Array[Frame]. The Frame class can't be
	# named from an extension, so take an empty copy of an existing frames array.
	var no_frames: Array = api.project.current_project.frames.duplicate()
	no_frames.clear()
	var project = api.project.new_project(no_frames, str(params.get("name", "untitled")), Vector2(width, height))
	if project == null:
		return _error("Pixelorama could not create the project")
	api.project.current_project = project
	return _cmd_get_project({})


func _cmd_open_file(params: Dictionary) -> Dictionary:
	var path := str(params.get("path", ""))
	if not FileAccess.file_exists(path):
		return _error("File not found: %s" % path)
	var open_save = api.import.open_save_autoload()
	match path.get_extension().to_lower():
		"pxo":
			open_save.open_pxo_file(path)
		"png", "jpg", "jpeg", "webp", "bmp", "tga":
			var image := Image.load_from_file(path)
			if image == null:
				return _error("Cannot load image: %s" % path)
			open_save.open_image_as_new_tab(path, image)
		_:
			return _error("Only .pxo files and images can be opened")
	return _cmd_get_project({})


func _cmd_draw_pixels(params: Dictionary) -> Dictionary:
	var target := _target_cel(params)
	if target.has("error"):
		return target

	var result := _prepare_draw(target, params)
	if not result.has("error"):
		_commit(target, target.image, "draw_pixels")
	return result


func _prepare_draw(target: Dictionary, params: Dictionary) -> Dictionary:
	var palette := {}
	var raw_palette = params.get("palette", {})
	if not raw_palette is Dictionary or raw_palette.is_empty():
		return _error("palette must map single characters to colors")
	for key in raw_palette:
		if str(key).length() != 1:
			return _error("Palette keys must be single characters, got '%s'" % key)
		var color := _parse_color(str(raw_palette[key]))
		if color.is_empty():
			return _error("Invalid color for '%s': %s" % [key, raw_palette[key]])
		palette[str(key)] = color[0]

	var image: Image = target.image
	var bounds := Rect2i(Vector2i.ZERO, image.get_size())
	var origin := Vector2i(int(params.get("x", 0)), int(params.get("y", 0)))
	var rows = params.get("rows", [])
	if not rows is Array:
		return _error("rows must be an array")
	var changed := 0
	var unknown := {}
	for y in rows.size():
		var row := str(rows[y])
		for x in row.length():
			var symbol := row[x]
			if not palette.has(symbol):
				if symbol != "." and symbol != " ":
					unknown[symbol] = true
				continue
			var pos := origin + Vector2i(x, y)
			if bounds.has_point(pos):
				image.set_pixelv(pos, palette[symbol])
				changed += 1

	var result := {"frame": target.frame, "layer": target.layer, "pixels_changed": changed}
	if not unknown.is_empty():
		result.ignored_characters = "".join(PackedStringArray(unknown.keys()))
	return result


func _cmd_fill_rect(params: Dictionary) -> Dictionary:
	var target := _target_cel(params)
	if target.has("error"):
		return target
	var color := _parse_color(str(params.get("color", "")))
	if color.is_empty():
		return _error("Invalid color: %s" % params.get("color"))

	var image: Image = target.image
	var rect := _rect_param(params, image.get_size())
	if rect.has_area():
		image.fill_rect(rect, color[0])
	_commit(target, image, "fill_rect")
	return {"frame": target.frame, "layer": target.layer, "pixels_changed": rect.get_area()}


func _cmd_copy_selection(params: Dictionary) -> Dictionary:
	return _shift_single_cel(params, "copy_selection", false)


func _cmd_move_selection(params: Dictionary) -> Dictionary:
	return _shift_single_cel(params, "move_selection", true)


func _cmd_shift_layer(params: Dictionary) -> Dictionary:
	return _shift_single_cel(params, "shift_layer", true)


func _shift_single_cel(params: Dictionary, command: String, move: bool) -> Dictionary:
	var target := _target_cel(params)
	if target.has("error"):
		return target
	var result := _prepare_shift(target, params, move, command == "shift_layer")
	if result.has("error"):
		return result
	if result.changed:
		_commit(target, target.image, command)
	return {"frame": target.frame, "layer": target.layer, "changed": result.changed}


func _prepare_shift(target: Dictionary, params: Dictionary, move: bool, whole: bool) -> Dictionary:
	var project = api.project.current_project
	var cel = project.frames[target.frame].cels[target.layer]
	if project.layers[target.layer].is_locked_in_hierarchy():
		return _error("Layer %d is locked" % target.layer)
	if cel.link_set != null and cel.link_set.size() > 1:
		return _error("Unlink the cel before shifting its pixels")
	var image: Image = target.image
	var bounds := Rect2i(Vector2i.ZERO, image.get_size())
	var source := bounds
	var destination := Vector2i.ZERO
	if whole:
		for key in ["dx", "dy"]:
			if not _valid_shift_number(params.get(key)):
				return _error("%s must be an integer from -8192 to 8192" % key)
		destination = Vector2i(int(params.dx), int(params.dy))
	else:
		for key in ["x", "y", "width", "height", "to_x", "to_y"]:
			if not _valid_shift_number(params.get(key)):
				return _error("%s must be an integer from -8192 to 8192" % key)
		source = Rect2i(int(params.x), int(params.y), int(params.width), int(params.height))
		if not source.has_area() or not bounds.encloses(source):
			return _error("The source rectangle must fit inside the canvas")
		destination = Vector2i(int(params.to_x), int(params.to_y))
	if source.position == destination:
		return {"changed": false}

	var original: PackedByteArray = image.get_data()
	_shift_pixels(image, source, destination, move, Color(0, 0, 0, 0))
	var changed := original != image.get_data()
	if cel.get_image().is_indexed:
		var cel_indices: Image = cel.get_image().indices_image
		var indices := Image.create_empty(bounds.size.x, bounds.size.y, false, Image.FORMAT_R8)
		indices.blit_rect(cel_indices, Rect2i(Vector2i.ZERO, cel_indices.get_size()), cel.offset)
		var original_indices := indices.get_data()
		_shift_pixels(indices, source, destination, move, Color(0, 0, 0, 0))
		target.indices = indices
		changed = changed or original_indices != indices.get_data()
	return {"changed": changed}


func _valid_shift_number(value: Variant) -> bool:
	return (value is int or value is float) and absf(value) <= 8192 and int(value) == value


func _shift_pixels(image: Image, source: Rect2i, destination: Vector2i, move: bool, empty: Color) -> void:
	# Snapshot before clearing to support overlapping source and destination.
	var copied := image.get_region(source)
	if move:
		image.fill_rect(source, empty)
	image.blit_rect(copied, Rect2i(Vector2i.ZERO, source.size), destination)


func _cmd_draw_pixels_in_frames(params: Dictionary) -> Dictionary:
	return _edit_frames(params, "draw_pixels_in_frames", true)


func _cmd_shift_layer_in_frames(params: Dictionary) -> Dictionary:
	return _edit_frames(params, "shift_layer_in_frames", false)


func _edit_frames(params: Dictionary, command: String, draw: bool) -> Dictionary:
	var project = api.project.current_project
	var frames = params.get("frames")
	if not frames is Array or frames.is_empty():
		return _error("Supply at least one frame")
	if frames.size() * project.size.x * project.size.y > 32 * 1024 * 1024:
		return _error("Too many canvas pixels for one frame batch (maximum 32 Mi pixels)")
	var layer = params.get("layer", project.current_layer)
	if not _valid_shift_number(layer) or layer < 0 or layer >= project.layers.size():
		return _error("Invalid layer")
	if project.layers[int(layer)].is_locked_in_hierarchy():
		return _error("Layer %d is locked" % int(layer))
	var seen := {}
	var edits := []
	var results := []
	for entry in frames:
		if draw and not entry is Dictionary:
			return _error("Each drawing entry must contain a frame and palette")
		var frame = entry.get("frame") if draw else entry
		if not (frame is int or frame is float) or frame < 0 or frame >= project.frames.size() or int(frame) != frame:
			return _error("Invalid frame: %s" % str(frame))
		frame = int(frame)
		if seen.has(frame):
			return _error("Frame %d occurs more than once" % frame)
		seen[frame] = true
		var target := _target_cel({"frame": frame, "layer": layer})
		if target.has("error"):
			return target
		var cel = project.frames[frame].cels[int(layer)]
		if cel.link_set != null and cel.link_set.size() > 1:
			return _error("Frame %d has a linked cel. Unlink it before editing selected frames." % frame)
		var result: Dictionary
		if draw:
			var drawing := params.duplicate()
			drawing.palette = entry.get("palette")
			result = _prepare_draw(target, drawing)
		else:
			result = _prepare_shift(target, params, true, true)
		if result.has("error"):
			return _error("Frame %d: %s" % [frame, result.error])
		result.frame = frame
		results.append(result)
		if result.get("changed", result.get("pixels_changed", 0) > 0):
			edits.append(target)
	if not edits.is_empty():
		_commit_edits(edits, command)
	return {"layer": int(layer), "frames": results}


func _cmd_read_pixels(params: Dictionary) -> Dictionary:
	var target := _target_cel(params, false)
	if target.has("error"):
		return target
	var image: Image = target.image
	var rect := _rect_param(params, image.get_size())
	if rect.get_area() > MAX_READ_PIXELS:
		return _error("Area too large (%d pixels, max %d). Read it in parts." % [rect.get_area(), MAX_READ_PIXELS])

	var symbols := {}
	var palette := {}
	var rows := []
	for y in range(rect.position.y, rect.end.y):
		var row := ""
		for x in range(rect.position.x, rect.end.x):
			var color := image.get_pixel(x, y)
			if color.a == 0:
				row += "."
				continue
			var html := "#" + color.to_html(color.a < 1)
			if not symbols.has(html):
				if symbols.size() == SYMBOLS.length():
					return _error("More than %d colors in this area. Read a smaller part." % SYMBOLS.length())
				var symbol := SYMBOLS[symbols.size()]
				symbols[html] = symbol
				palette[symbol] = html
			row += symbols[html]
		rows.append(row)
	var slots := {}
	for symbol in palette:
		var slot := _palette_slot_of(Color.html(palette[symbol]))
		if slot >= 0:
			slots[symbol] = slot
	return {
		"frame": target.frame,
		"layer": target.layer,
		"x": rect.position.x,
		"y": rect.position.y,
		"palette": palette,
		"palette_slots": slots,
		"rows": rows,
	}


func _cmd_get_image(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	if frame < 0 or frame >= project.frames.size():
		return _error("Frame %d does not exist" % frame)
	var image := _blend_frame(project, frame)
	var scale := int(params.get("scale", 0))
	if scale <= 0:
		scale = maxi(1, 512 / maxi(image.get_width(), image.get_height()))
	if scale > 1:
		image.resize(image.get_width() * scale, image.get_height() * scale, Image.INTERPOLATE_NEAREST)
	return {"png": Marshalls.raw_to_base64(image.save_png_to_buffer()), "frame": frame, "scale": scale}


func _cmd_add_layer(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var above := int(params.get("above", project.layers.size() - 1))
	if above < 0 or above >= project.layers.size():
		return _error("Layer %d does not exist" % above)
	api.project.add_new_layer(above, str(params.get("name", "")))
	api.project.select_cels([[project.current_frame, above + 1]])
	return _cmd_get_project({})


func _cmd_rename_layer(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var layer := int(params.get("layer", project.current_layer))
	var name := str(params.get("name", "")).strip_edges()
	if layer < 0 or layer >= project.layers.size():
		return _error("Layer %d does not exist" % layer)
	if name.is_empty():
		return _error("name is required")
	project.layers[layer].name = name
	# Same way ExtensionsApi.add_new_layer updates the timeline label.
	var layer_vbox: VBoxContainer = api.general.get_global().animation_timeline.layer_vbox
	var l_idx := layer_vbox.get_child_count() - (layer + 1)
	if l_idx >= 0 and l_idx < layer_vbox.get_child_count():
		layer_vbox.get_child(l_idx).label.text = name
	return _cmd_get_project({})


func _cmd_get_palette(_params: Dictionary) -> Dictionary:
	var palettes_api = api.palette.autoload()
	var project = api.project.current_project
	var current = palettes_api.current_palette
	var colors := []
	if current != null:
		var indices: Array = current.colors.keys()
		indices.sort()
		for i in indices:
			var c: Color = current.colors[i].color
			colors.append({"slot": i, "color": "#" + c.to_html(c.a < 1)})
	return {
		"current": _current_palette_name(),
		"is_project_palette": current != null and current.is_project_palette,
		"size": 0 if current == null else current.colors_max,
		"colors": colors,
		"global_palettes": palettes_api.palettes.keys(),
		"project_palettes": project.palettes.keys(),
		"color_mode": "indexed" if project.is_indexed() else "rgba",
	}


func _cmd_select_palette(params: Dictionary) -> Dictionary:
	var name := str(params.get("name", ""))
	var palettes_api = api.palette.autoload()
	var project = api.project.current_project
	if not palettes_api.palettes.has(name) and not project.palettes.has(name):
		return _error("No palette named '%s'" % name)
	palettes_api.select_palette(name)
	return _cmd_get_palette({})


## Makes a new project palette from a list of colors (slot 0 first) and selects it.
## In indexed mode all images recolor to the new palette, slot by slot.
func _cmd_create_palette(params: Dictionary) -> Dictionary:
	var name := str(params.get("name", "")).strip_edges()
	var raw = params.get("colors", [])
	if name.is_empty():
		return _error("name is required")
	if not raw is Array or raw.is_empty() or raw.size() > 255:
		return _error("colors must be a list of 1 to 255 colors")
	var width := int(params.get("width", 8))
	if width < 1:
		width = 8
	var entries := []
	for i in raw.size():
		var parsed := _parse_color(str(raw[i]))
		if parsed.is_empty() or str(raw[i]).begins_with("@"):
			return _error("Invalid color at slot %d: %s" % [i, raw[i]])
		entries.append({"color": parsed[0], "index": i})
	var height := int(ceil(float(raw.size()) / width))
	var project = api.project.current_project
	if project.palettes.has(name):
		return _error("The project already has a palette named '%s'" % name)
	api.palette.create_palette_from_data(name, {"colors": entries, "width": width, "height": height}, false)
	return _cmd_get_palette({})


func _cmd_set_color_mode(params: Dictionary) -> Dictionary:
	var mode := str(params.get("mode", "")).to_lower()
	if mode != "indexed" and mode != "rgba":
		return _error("mode must be 'indexed' or 'rgba'")
	var project = api.project.current_project
	if (mode == "indexed") == project.is_indexed():
		return _cmd_get_project({})
	# Same path as the menu Image > Color mode (one undo step). 0 = RGBA, 1 = Indexed.
	api.general.get_global().top_menu_container._color_mode_submenu_id_pressed(1 if mode == "indexed" else 0)
	return _cmd_get_project({})


## Changes the canvas size without scaling. anchor says where the old image stays:
## "bottom" (default) keeps the bottom edge and centers horizontally.
func _cmd_resize_canvas(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var width := int(params.get("width", project.size.x))
	var height := int(params.get("height", project.size.y))
	if width < 1 or height < 1 or width > 4096 or height > 4096:
		return _error("Size must be between 1 and 4096 pixels")
	var anchor := str(params.get("anchor", "bottom")).to_lower()
	var dx := width - int(project.size.x)
	var dy := height - int(project.size.y)
	var ox := dx / 2
	var oy := dy / 2
	if "left" in anchor:
		ox = 0
	elif "right" in anchor:
		ox = dx
	if "top" in anchor:
		oy = 0
	elif "bottom" in anchor:
		oy = dy
	api.general.get_drawing_algos().resize_canvas(width, height, ox, oy)
	return _cmd_get_project({})


func _cmd_add_frame(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var after := int(params.get("after", project.frames.size() - 1))
	if after < 0 or after >= project.frames.size():
		return _error("Frame %d does not exist" % after)
	api.project.add_new_frame(after)
	api.project.select_cels([[after + 1, project.current_layer]])
	return _cmd_get_project({})


func _cmd_select_cel(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	var layer := int(params.get("layer", project.current_layer))
	if frame < 0 or frame >= project.frames.size() or layer < 0 or layer >= project.layers.size():
		return _error("No cel at frame %d, layer %d" % [frame, layer])
	api.project.select_cels([[frame, layer]])
	return _cmd_get_project({})


## Ctrl+Z, [param steps] times. Goes through Project.commit_undo(), like Edit > Undo.
func _cmd_undo(params: Dictionary) -> Dictionary:
	return _undo_redo(params, true)


## Ctrl+Y, [param steps] times. Goes through Project.commit_redo(), like Edit > Redo.
func _cmd_redo(params: Dictionary) -> Dictionary:
	return _undo_redo(params, false)


func _undo_redo(params: Dictionary, undo: bool) -> Dictionary:
	var steps := clampi(int(params.get("steps", 1)), 1, 50)
	var project = api.project.current_project
	var history = project.undo_redo
	var names := []
	for i in steps:
		if undo:
			if not history.has_undo():
				break
			names.append(history.get_current_action_name())
			project.commit_undo()
		else:
			if not history.has_redo():
				break
			# The step to redo is the one after the current action.
			names.append(history.get_action_name(history.get_current_action() + 1))
			project.commit_redo()
	var result := {
		"requested": steps,
		"done": names.size(),
		"steps": names,
		"can_undo": history.has_undo(),
		"can_redo": history.has_redo(),
	}
	if names.size() < steps:
		result.note = "Only %d step(s) available, fewer than the %d requested" % [names.size(), steps]
	result.project = _cmd_get_project({})
	return result


func _cmd_save_project(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var path := str(params.get("path", project.save_path))
	if path.is_empty():
		return _error("The project has never been saved, so a path is required")
	if not path.is_absolute_path() or path.get_extension().to_lower() != "pxo":
		return _error("path must be an absolute path ending in .pxo")
	if not api.import.open_save_autoload().save_pxo_file(path, false):
		return _error("Saving failed")
	return {"path": path}


func _cmd_export_png(params: Dictionary) -> Dictionary:
	var project = api.project.current_project
	var path := str(params.get("path", ""))
	if not path.is_absolute_path() or path.get_extension().to_lower() != "png":
		return _error("path must be an absolute path ending in .png")

	var frames := []
	if params.get("all_frames", false):
		frames = range(project.frames.size())
	else:
		var frame := int(params.get("frame", project.current_frame))
		if frame < 0 or frame >= project.frames.size():
			return _error("Frame %d does not exist" % frame)
		frames = [frame]

	# All frames are laid out left to right as a sprite sheet.
	var size: Vector2i = project.size
	var sheet := Image.create(size.x * frames.size(), size.y, false, Image.FORMAT_RGBA8)
	for i in frames.size():
		var image := _blend_frame(project, frames[i])
		image.convert(Image.FORMAT_RGBA8)
		sheet.blit_rect(image, Rect2i(Vector2i.ZERO, size), Vector2i(size.x * i, 0))

	var scale := maxi(1, int(params.get("scale", 1)))
	if scale > 1:
		sheet.resize(sheet.get_width() * scale, sheet.get_height() * scale, Image.INTERPOLATE_NEAREST)
	var err := sheet.save_png(path)
	if err != OK:
		return _error("Cannot write %s: %s" % [path, error_string(err)])
	return {"path": path, "width": sheet.get_width(), "height": sheet.get_height(), "frames": frames.size()}


## Finds the cel a drawing command works on (current cel unless frame/layer are given)
## and returns a copy of its image to modify.
func _target_cel(params: Dictionary, for_writing := true) -> Dictionary:
	var project = api.project.current_project
	var frame := int(params.get("frame", project.current_frame))
	var layer := int(params.get("layer", project.current_layer))
	if frame < 0 or frame >= project.frames.size():
		return _error("Frame %d does not exist" % frame)
	if layer < 0 or layer >= project.layers.size():
		return _error("Layer %d does not exist" % layer)

	var cel = project.frames[frame].cels[layer]
	if cel.get_class_name() != "PixelCel":
		return _error("Layer %d is not a pixel layer" % layer)
	if for_writing and project.layers[layer].locked:
		return _error("Layer %d is locked" % layer)

	# Since Pixelorama 1.2 (API 10) a cel image only covers the used area and
	# starts at cel.offset (a new layer is 1 x 1). Build a canvas-sized copy so
	# all commands can work in canvas coordinates.
	var size: Vector2i = project.size
	var image := Image.create_empty(size.x, size.y, false, Image.FORMAT_RGBA8)
	var cel_image := Image.new()
	cel_image.copy_from(cel.get_image())
	cel_image.convert(Image.FORMAT_RGBA8)
	var cel_offset: Vector2i = cel.offset if "offset" in cel else Vector2i.ZERO
	image.blit_rect(cel_image, Rect2i(Vector2i.ZERO, cel_image.get_size()), cel_offset)
	return {"frame": frame, "layer": layer, "image": image}


## A single action can update one or more canvas-sized cel images.
func _commit(target: Dictionary, image: Image, command: String) -> void:
	target.image = image
	_commit_edits([target], command)


func _commit_edits(edits: Array, command: String) -> void:
	var project = api.project.current_project
	var first: Dictionary = edits[0]
	var cels: Array = project.frames[first.frame].cels.duplicate()
	cels.clear()
	for edit in edits:
		cels.append(project.frames[edit.frame].cels[edit.layer])

	var undo_data := {}
	project.serialize_cel_undo_data(cels, undo_data)
	for i in edits.size():
		_write_cel(project, cels[i], edits[i])

	var redo_data := {}
	project.serialize_cel_undo_data(cels, redo_data)
	var history = project.undo_redo
	var layer_name: String = project.layers[first.layer].name
	history.create_action("MCP %s: %s" % [command, layer_name])
	project.deserialize_cel_undo_data(redo_data, undo_data)
	for cel in cels:
		history.add_do_method(cel.update_texture)
		history.add_undo_method(cel.update_texture)
	var global = api.general.get_global()
	history.add_do_method(global.undo_or_redo.bind(false))
	history.add_undo_method(global.undo_or_redo.bind(true))
	history.commit_action()


func _write_cel(project, cel, target: Dictionary) -> void:
	var image: Image = target.image
	var used := image.get_used_rect()
	var new_offset := Vector2i.ZERO
	var part: Image
	if used.size == Vector2i.ZERO:
		part = Image.create_empty(1, 1, false, Image.FORMAT_RGBA8)
	else:
		part = image.get_region(used)
		new_offset = used.position
	part.convert(project.get_image_format())
	var cel_image = cel.get_image()
	if target.has("indices"):
		cel_image.copy_from(part)
		var indices: Image = target.indices
		cel_image.indices_image.copy_from(indices.get_region(Rect2i(new_offset, part.get_size())))
	else:
		cel_image.copy_from_custom(part)
	cel.change_offset(new_offset)


func _blend_frame(project, frame: int) -> Image:
	var image: Image = project.new_empty_image()
	api.general.get_drawing_algos().blend_layers(image, project.frames[frame], Vector2i.ZERO, project)
	return image


func _rect_param(params: Dictionary, size: Vector2i) -> Rect2i:
	var x := int(params.get("x", 0))
	var y := int(params.get("y", 0))
	var rect := Rect2i(x, y, int(params.get("width", size.x - x)), int(params.get("height", size.y - y)))
	return rect.intersection(Rect2i(Vector2i.ZERO, size))


## Returns [color] or [] when the text is not a color.
## Accepts #rgb, #rrggbb, #rrggbbaa, color names and "transparent".
func _parse_color(text: String) -> Array:
	text = text.strip_edges()
	# "@n" means slot n (from 0) of the palette that is selected in Pixelorama.
	if text.begins_with("@") and text.substr(1).is_valid_int():
		var slot_color = _palette_slot_color(int(text.substr(1)))
		return [] if slot_color == null else [slot_color]
	if text.to_lower() == "transparent":
		return [Color(0, 0, 0, 0)]
	if Color.html_is_valid(text):
		return [Color.html(text)]
	var named := Color.from_string(text, Color(0, 0, 0, -1))
	if named.a < 0:
		return []
	return [named]


func _current_palette_name() -> String:
	var current = api.palette.autoload().current_palette
	return "" if current == null else current.name


## Returns the color in slot [param slot] of the selected palette, or null.
func _palette_slot_color(slot: int):
	var current = api.palette.autoload().current_palette
	if current == null or not current.colors.has(slot):
		return null
	return current.colors[slot].color


## Returns the slot of [param color] in the selected palette, or -1.
func _palette_slot_of(color: Color) -> int:
	var current = api.palette.autoload().current_palette
	if current == null:
		return -1
	for i in current.colors:
		if current.colors[i].color.is_equal_approx(color):
			return i
	return -1


func _error(message: String) -> Dictionary:
	return {"error": message}

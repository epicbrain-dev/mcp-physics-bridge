extends Node
class_name PhysicsBridgeClient

## Connects Godot 4 to mcp-physics-bridge over WebSocket with token-based handshake.
## Synchronizes physics bodies at 60 FPS in _physics_process.

@export var server_url: String = "ws://localhost:8080"
@export var auth_token: String = "" # Set token or read from data/.runtime_token
@export var entity_count: int = 50

var _socket: WebSocketPeer = WebSocketPeer.new()
var _frame_id: int = 0
var _is_connected: bool = false

func _ready() -> void:
	connect_to_bridge()

func connect_to_bridge() -> void:
	# Add token authentication header or query parameter
	var headers: PackedStringArray = []
	if auth_token != "":
		headers.append("Authorization: Bearer " + auth_token)

	_socket.handshake_headers = headers
	var err = _socket.connect_to_url(server_url)
	if err != OK:
		printerr("[MCP Bridge] Connection initialization failed: ", err)
	else:
		print("[MCP Bridge] Connecting to WebSocket bridge at ", server_url)

func _physics_process(delta: float) -> void:
	_socket.poll()
	var state = _socket.get_ready_state()

	if state == WebSocketPeer.STATE_OPEN:
		if not _is_connected:
			_is_connected = true
			print("[MCP Bridge] WebSocket connection established successfully.")

		# Read any pending responses from bridge
		while _socket.get_available_packet_count() > 0:
			var packet = _socket.get_packet()
			_handle_bridge_packet(packet)

		# Send current 60 FPS physics frame
		_send_physics_frame(delta)

	elif state == WebSocketPeer.STATE_CLOSED:
		if _is_connected:
			_is_connected = false
			print("[MCP Bridge] WebSocket disconnected. Code: ", _socket.get_close_code(), " Reason: ", _socket.get_close_reason())

func _send_physics_frame(delta: float) -> void:
	_frame_id += 1

	var positions: Array = []
	var velocities: Array = []

	for i in range(entity_count):
		positions.append_array([i * 1.0, 2.0, 0.0])
		velocities.append_array([0.0, -9.8 * delta, 0.0])

	var frame_data = {
		"frameId": _frame_id,
		"timestampNs": Time.get_ticks_usec() * 1000,
		"entityCount": entity_count,
		"deltaTime": delta,
		"positions": positions,
		"linearVelocities": velocities
	}

	var json_str = JSON.stringify(frame_data)
	_socket.send_text(json_str)

func _handle_bridge_packet(packet: PackedByteArray) -> void:
	var message_text = packet.get_string_from_utf8()
	var json = JSON.new()
	var parse_result = json.parse(message_text)
	if parse_result == OK:
		var response = json.get_data()
		# Process validation corrections or telemetry from bridge
		if response.has("status") and response["status"] != 0:
			print("[MCP Bridge] Frame correction received: ", response)

func _exit_tree() -> void:
	if _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_socket.close(1000, "Node exiting")

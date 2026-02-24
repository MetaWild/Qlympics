#!/usr/bin/env python3
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import calendar
import re

API_URL = os.getenv("API_URL", "http://localhost:3001").rstrip("/")
QUAI_RPC_URL = os.getenv("QUAI_RPC_URL", "https://orchard.rpc.quai.network/cyprus1")
POSTGRES_USER = os.getenv("POSTGRES_USER", "qlympics")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "qlympics")
POSTGRES_DB = os.getenv("POSTGRES_DB", "qlympics")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_FORCE_DOCKER = os.getenv("REDIS_FORCE_DOCKER", "") == "1"
POW_MAX_ITERS = int(os.getenv("POW_MAX_ITERS", "500000"))
TREASURY_PRIVATE_KEY = os.getenv("QUAI_TREASURY_PRIVATE_KEY", "")
AGENT_PAYOUT_ADDRESS = os.getenv("E2E_AGENT_PAYOUT_ADDRESS", "0x00482Eebe76c6F818c308cFFD8b7eAa19B2E504d")
AGENT2_PAYOUT_ADDRESS = os.getenv("E2E_AGENT2_PAYOUT_ADDRESS", "0x0068d788E534DE2aC81b523Ed3C8F735269E6629")
PLAYER_COUNT = int(os.getenv("E2E_PLAYER_COUNT", "2"))
LOG_MOVES = os.getenv("E2E_LOG_MOVES", "1") != "0"
REWARD_POOL = os.getenv("E2E_REWARD_POOL", "1")
COIN_WAIT_SEC = float(os.getenv("E2E_COIN_WAIT_SEC", "10"))
MOVE_TIMEOUT_SEC = float(os.getenv("E2E_MOVE_TIMEOUT_SEC", "20"))
PAYOUT_WAIT_SEC = float(os.getenv("E2E_PAYOUT_WAIT_SEC", "30"))
TX_WAIT_SEC = float(os.getenv("E2E_TX_WAIT_SEC", "60"))
BALANCE_WAIT_SEC = float(os.getenv("E2E_BALANCE_WAIT_SEC", "90"))
FINISH_WAIT_SEC = float(os.getenv("E2E_FINISH_WAIT_SEC", "20"))
TICK_STALL_SEC = float(os.getenv("E2E_TICK_STALL_SEC", "3"))
STATE_REFRESH_SEC = float(os.getenv("E2E_STATE_REFRESH_SEC", "0.4"))
HTTP_TIMEOUT_SEC = float(os.getenv("E2E_HTTP_TIMEOUT_SEC", "180"))
DEMO_UI = os.getenv("E2E_DEMO_UI", "") == "1"
GAME_DURATION_SEC = int(os.getenv("E2E_GAME_DURATION_SEC", "10"))
GAME_COINS_PER_MATCH = int(os.getenv("E2E_GAME_COINS_PER_MATCH", "0"))  # 0 => derived
JOIN_DELAY_SEC = float(os.getenv("E2E_JOIN_DELAY_SEC", "0"))
WEB_URL = os.getenv("E2E_WEB_URL", "http://localhost:5173").rstrip("/")
DEMO_FINISH_GRACE_SEC = float(os.getenv("E2E_DEMO_FINISH_GRACE_SEC", "60"))
SCENARIO = os.getenv("E2E_SCENARIO", "").strip().lower()  # "", "scale"

def log(msg: str):
    print(msg, flush=True)


def http_json(method: str, path: str, body=None, headers=None):
    url = f"{API_URL}{path}"
    data = None
    request_headers = {"content-type": "application/json"}
    if headers:
        request_headers.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload)
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8")
        raise RuntimeError(f"HTTP {exc.code} {url}: {payload}") from exc


def rpc_json(method: str, params):
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8")
    req = urllib.request.Request(
        QUAI_RPC_URL,
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        if "error" in payload:
            raise RuntimeError(payload["error"])
        return payload.get("result")


def solve_pow(nonce: str, difficulty: int):
    target = "0" * difficulty
    for i in range(POW_MAX_ITERS):
        solution = f"sol-{i}"
        digest = hashlib.sha256(f"{nonce}:{solution}".encode("utf-8")).hexdigest()
        if digest.startswith(target):
            return solution, i + 1
    raise RuntimeError(f"Failed to solve PoW in {POW_MAX_ITERS} iterations. Increase POW_MAX_ITERS or reduce difficulty.")



def runtime_identity_from_label(label: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_-]", "", label).strip()
    if not normalized:
        return "agent"
    return normalized[:10]


def register_agent(payout_address: str, label: str):
    log(f"Requesting PoW challenge for {label}...")
    _, challenge = http_json("POST", "/agents/challenge", body={})
    challenge_id = challenge["challenge_id"]
    nonce = challenge["nonce"]
    difficulty = int(challenge["difficulty"])

    log(f"Solving PoW for {label}...")
    solution, attempts = solve_pow(nonce, difficulty)
    log(f"{label} solved PoW in {attempts} attempts")

    log(f"Verifying and requesting api_key for {label}...")
    _, verify = http_json(
        "POST",
        "/agents/verify",
        body={
            "challenge_id": challenge_id,
            "solution": solution,
            "payout_address": payout_address,
            "runtime_identity": runtime_identity_from_label(label),
            "name": f"E2E {label}",
            "version": "v1",
        },
    )
    return verify["api_key"]


def run_cmd(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def create_game_mode(max_players: int, duration_sec: int, coins_per_match: int, reward_pool_quai=None):
    pool = reward_pool_quai if reward_pool_quai is not None else REWARD_POOL
    sql = (
        "INSERT INTO game_modes (title, max_players, duration_sec, coins_per_match, reward_pool_quai, status) "
        "VALUES ('Coin Runner', %d, %d, %d, %s, 'ACTIVE') RETURNING id;"
        % (max_players, duration_sec, coins_per_match, pool)
    )
    output = run_cmd([
        "docker",
        "compose",
        "exec",
        "-T",
        "-e",
        f"PGPASSWORD={POSTGRES_PASSWORD}",
        "postgres",
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-tA",
        "-c",
        sql,
    ])
    game_mode_id = output.splitlines()[0].strip()
    if not game_mode_id:
        raise RuntimeError("Failed to create game mode")
    return game_mode_id


_redis_force_docker = REDIS_FORCE_DOCKER


def redis_get_via_socket(key: str) -> str:
    with socket.create_connection((REDIS_HOST, REDIS_PORT), timeout=2) as sock:
        command = f"*2\r\n$3\r\nGET\r\n${len(key)}\r\n{key}\r\n".encode("utf-8")
        sock.sendall(command)
        with sock.makefile("rb") as stream:
            line = stream.readline()
            if not line:
                return ""
            if line == b"$-1\r\n":
                return ""
            if line.startswith(b"$"):
                length = int(line[1:-2])
                if length <= 0:
                    return ""
                data = stream.read(length)
                stream.read(2)
                return data.decode("utf-8")
            if line.startswith(b"-"):
                raise RuntimeError(f"Redis error: {line[1:].decode('utf-8').strip()}")
            return ""


def redis_get(key: str):
    global _redis_force_docker
    if not _redis_force_docker:
        try:
            return redis_get_via_socket(key)
        except Exception:
            _redis_force_docker = True

    output = run_cmd([
        "docker",
        "compose",
        "exec",
        "-T",
        "redis",
        "redis-cli",
        "GET",
        key,
    ])
    return output


def get_balance_wei(address: str) -> int:
    balance_hex = rpc_json("quai_getBalance", [address, "latest"])
    if not isinstance(balance_hex, str):
        raise RuntimeError(f"Invalid balance payload: {balance_hex!r}")
    return int(balance_hex, 16)


def quai_str_to_wei(amount: str) -> int:
    if amount is None:
        raise RuntimeError("Invalid amount: None")
    raw = str(amount).strip()
    if raw.startswith("-"):
        raise RuntimeError(f"Invalid negative amount: {raw}")
    if "." not in raw:
        return int(raw) * 10**18
    whole, frac = raw.split(".", 1)
    frac = (frac + "0" * 18)[:18]
    return int(whole or "0") * 10**18 + int(frac or "0")


def wei_to_quai(wei: int) -> float:
    return wei / 1e18


def wait_for_state(lobby_id: str):
    start = time.time()
    while True:
        state_raw = redis_get(f"lobby:{lobby_id}:state")
        if state_raw and state_raw != "(nil)":
            return json.loads(state_raw)
        if time.time() - start > COIN_WAIT_SEC:
            raise RuntimeError(
                f"Timed out waiting for lobby state after {COIN_WAIT_SEC:.0f}s. "
                "Is the game server running and lobby active?"
            )
        time.sleep(0.2)


def wait_for_lobby_finish(lobby_id: str):
    deadline = time.time() + FINISH_WAIT_SEC
    while time.time() < deadline:
        state_raw = redis_get(f"lobby:{lobby_id}:state")
        if state_raw and state_raw != "(nil)":
            state = json.loads(state_raw)
            if state.get("status") == "FINISHED":
                return
        time.sleep(0.5)
    raise RuntimeError(f"Lobby did not finish within {FINISH_WAIT_SEC:.0f}s")


def explore_for_coin(lobby_id: str, api_key: str):
    state = wait_for_state(lobby_id)
    players = state["players"]
    agent_id = list(players.keys())[0]
    width = int(state["width"])
    height = int(state["height"])
    print(f"Grid size: {width}x{height} (timeouts move={MOVE_TIMEOUT_SEC}s stall={TICK_STALL_SEC}s)")

    def step(direction):
        try:
            http_json(
                "POST",
                f"/lobbies/{lobby_id}/input",
                body={"direction": direction},
                headers={"x-api-key": api_key},
            )
        except RuntimeError as exc:
            if "Agent not in lobby" in str(exc):
                latest = redis_get(f"lobby:{lobby_id}:state")
                if latest and latest != "(nil)":
                    try:
                        latest_state = json.loads(latest)
                        if latest_state.get("status") == "FINISHED":
                            raise RuntimeError("Lobby finished before coin was collected") from exc
                    except json.JSONDecodeError:
                        pass
            raise
        time.sleep(0.11)

    def refresh():
        payload = redis_get(f"lobby:{lobby_id}:state")
        if not payload or payload == "(nil)":
            raise RuntimeError("Lobby state missing during exploration")
        state_payload = json.loads(payload)
        if state_payload.get("status") == "FINISHED":
            raise RuntimeError("Lobby finished before coin was collected")
        return state_payload

    def player_state(cur_state):
        return cur_state["players"][agent_id]

    def score(cur_state):
        return player_state(cur_state)["score"]

    start_score = score(state)
    explore_start = time.time()
    last_tick = state.get("tick", 0)
    last_tick_at = time.time()
    last_refresh_at = time.time()

    def maybe_refresh(force: bool = False):
        nonlocal state, last_tick, last_tick_at, last_refresh_at
        now = time.time()
        if not force and now - last_refresh_at < STATE_REFRESH_SEC:
            return
        state = refresh()
        last_refresh_at = now
        current_tick = state.get("tick", 0)
        if current_tick != last_tick:
            last_tick = current_tick
            last_tick_at = time.time()
        elif time.time() - last_tick_at > TICK_STALL_SEC:
            raise RuntimeError(
                f"Lobby tick stalled for {TICK_STALL_SEC:.0f}s. "
                "Game server may not be processing inputs."
            )

    def move_to(target_x, target_y):
        nonlocal state, last_tick, last_tick_at
        player = player_state(state)
        while True:
            if player["x"] == target_x and player["y"] == target_y:
                return
            if player["x"] < target_x:
                step("right")
                player["x"] = min(player["x"] + 1, width - 1)
            elif player["x"] > target_x:
                step("left")
                player["x"] = max(player["x"] - 1, 0)
            elif player["y"] < target_y:
                step("down")
                player["y"] = min(player["y"] + 1, height - 1)
            else:
                step("up")
                player["y"] = max(player["y"] - 1, 0)
            maybe_refresh()
            player = player_state(state)
            if score(state) > start_score:
                return
            if time.time() - explore_start > MOVE_TIMEOUT_SEC:
                raise RuntimeError(
                    f"Timed out exploring after {MOVE_TIMEOUT_SEC:.0f}s. "
                    "Increase E2E_MOVE_TIMEOUT_SEC or reduce grid size."
                )

    def wait_for_coin_state():
        nonlocal state
        deadline = time.time() + COIN_WAIT_SEC
        while time.time() < deadline:
            maybe_refresh(force=True)
            if state.get("coins"):
                return
            time.sleep(0.1)

    wait_for_coin_state()

    if state.get("coins"):
        coin = state["coins"][0]
        move_to(int(coin["x"]), int(coin["y"]))
        maybe_refresh(force=True)
        if score(state) > start_score:
            return agent_id

    move_to(0, 0)
    maybe_refresh(force=True)

    for y in range(height):
        row = list(range(width)) if y % 2 == 0 else list(range(width - 1, -1, -1))
        for x in row:
            move_to(x, y)
            maybe_refresh(force=True)
            if score(state) > start_score:
                return agent_id
            if time.time() - explore_start > MOVE_TIMEOUT_SEC:
                raise RuntimeError(
                    f"Timed out exploring after {MOVE_TIMEOUT_SEC:.0f}s. "
                    "Increase E2E_MOVE_TIMEOUT_SEC or reduce grid size."
                )

    raise RuntimeError("Exploration finished without collecting a coin")

def get_lobby_agent_ids_by_slot(lobby_id: str):
    output = run_cmd([
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-tA",
        "-c",
        f"SELECT agent_id, slot FROM lobby_players WHERE lobby_id = '{lobby_id}' AND status = 'JOINED' ORDER BY slot ASC",
    ])
    rows = [line.strip() for line in output.splitlines() if line.strip()]
    pairs = []
    for line in rows:
        agent_id, slot = line.split("|", 1)
        pairs.append((int(slot), agent_id))
    pairs.sort(key=lambda item: item[0])
    return [agent_id for _, agent_id in pairs]


def send_input(lobby_id: str, api_key: str, label: str, direction: str):
    if LOG_MOVES:
        log(f"{label} moved {direction}")
    http_json(
        "POST",
        f"/lobbies/{lobby_id}/input",
        body={"direction": direction},
        headers={"x-api-key": api_key},
    )


def pick_direction_toward(player, target_x: int, target_y: int):
    dx = target_x - player["x"]
    dy = target_y - player["y"]
    if dx != 0:
        return "right" if dx > 0 else "left"
    if dy != 0:
        return "down" if dy > 0 else "up"
    return "up"


def assign_coins_to_players(state, agent_ids):
    coins = list(state.get("coins") or [])
    players = state.get("players") or {}
    if len(coins) < len(agent_ids):
        return {}

    # Greedy assignment by closest coin; fine for 2 players and tends to avoid crossing.
    remaining = coins[:]
    assignments = {}
    for agent_id in agent_ids:
        p = players[agent_id]
        best = None
        best_dist = None
        for coin in remaining:
            dist = abs(int(coin["x"]) - int(p["x"])) + abs(int(coin["y"]) - int(p["y"]))
            if best is None or dist < best_dist:
                best = coin
                best_dist = dist
        if best is None:
            continue
        assignments[agent_id] = (int(best["x"]), int(best["y"]), int(best["id"]))
        remaining = [c for c in remaining if int(c["id"]) != int(best["id"])]
    return assignments


def two_player_collect_one_each(lobby_id: str, agent_ids, api_keys_by_agent):
    state = wait_for_state(lobby_id)
    width = int(state["width"])
    height = int(state["height"])
    log(f"Grid size: {width}x{height} (2-player run)")

    deadline = time.time() + MOVE_TIMEOUT_SEC
    last_scores = {aid: int(state["players"][aid]["score"]) for aid in agent_ids}
    collected = {aid: False for aid in agent_ids}

    # Wait until enough coins exist to give each player one target.
    coin_deadline = time.time() + COIN_WAIT_SEC
    while time.time() < coin_deadline:
        payload = redis_get(f"lobby:{lobby_id}:state")
        if payload and payload != "(nil)":
            state = json.loads(payload)
            if len(state.get("coins") or []) >= len(agent_ids):
                break
        time.sleep(0.1)

    assignments = assign_coins_to_players(state, agent_ids)
    if not assignments:
        raise RuntimeError("Not enough coins spawned for 2-player assignment")

    if LOG_MOVES:
        coins = ", ".join([f"id={c['id']}@({c['x']},{c['y']})" for c in (state.get("coins") or [])])
        log(f"Coins: {coins}")
        for aid in agent_ids:
            tx, ty, cid = assignments[aid]
            log(f"P{agent_ids.index(aid)+1} targeting coin id={cid}@({tx},{ty})")

    while time.time() < deadline:
        payload = redis_get(f"lobby:{lobby_id}:state")
        if not payload or payload == "(nil)":
            raise RuntimeError("Lobby state missing during 2-player exploration")
        state = json.loads(payload)
        if state.get("status") == "FINISHED":
            break

        # Recompute assignments if coins changed and someone hasn't collected yet.
        if any(not collected[aid] for aid in agent_ids):
            assignments = assign_coins_to_players(state, [aid for aid in agent_ids if not collected[aid]])

        # Emit one input per agent per tick (or as close as we can) to keep movement smooth.
        for idx, agent_id in enumerate(agent_ids):
            if collected[agent_id]:
                continue
            player = state["players"][agent_id]
            if agent_id in assignments:
                tx, ty, _cid = assignments[agent_id]
            else:
                # Fallback: sweep to a corner to reduce collisions.
                tx, ty = (0, 0) if idx == 0 else (width - 1, height - 1)

            direction = pick_direction_toward(player, tx, ty)
            send_input(lobby_id, api_keys_by_agent[agent_id], f"P{idx+1}", direction)

        time.sleep(0.11)

        # Check for score changes.
        payload = redis_get(f"lobby:{lobby_id}:state")
        if payload and payload != "(nil)":
            state = json.loads(payload)
            for idx, agent_id in enumerate(agent_ids):
                score = int(state["players"][agent_id]["score"])
                if score > last_scores[agent_id]:
                    last_scores[agent_id] = score
                    if not collected[agent_id]:
                        collected[agent_id] = True
                        log(f"P{idx+1} collected a coin (score={score})")

        if all(collected.values()):
            return

    raise RuntimeError("Timed out before both players collected at least 1 coin")

def two_player_compete_until_finish(lobby_id: str, agent_ids, api_keys_by_agent):
    state = wait_for_state(lobby_id)
    width = int(state["width"])
    height = int(state["height"])
    log(f"Grid size: {width}x{height} (2-player demo until finish)")

    # Run until the lobby finishes (time-based). We keep inputs smooth for viewers.
    # Use ends_at from state so long demo durations don't trip short default timeouts.
    # Add a generous grace so minor scheduling hiccups don't fail the demo.
    try:
        ends_at = state.get("ends_at") or ""
        ends_at_epoch = calendar.timegm(time.strptime(ends_at[:19], "%Y-%m-%dT%H:%M:%S")) if ends_at else 0
    except Exception:
        ends_at_epoch = 0
    deadline = ends_at_epoch + DEMO_FINISH_GRACE_SEC if ends_at_epoch else time.time() + (GAME_DURATION_SEC + DEMO_FINISH_GRACE_SEC)

    last_tick = int(state.get("tick", 0) or 0)
    last_progress = time.time()
    while True:
        payload = redis_get(f"lobby:{lobby_id}:state")
        if not payload or payload == "(nil)":
            raise RuntimeError("Lobby state missing during 2-player demo")
        state = json.loads(payload)
        if state.get("status") == "FINISHED":
            return

        # Fail fast if the tick loop stalls (common root cause when demo hangs).
        tick = int(state.get("tick", 0) or 0)
        if tick != last_tick:
            last_tick = tick
            last_progress = time.time()
        elif time.time() - last_progress > TICK_STALL_SEC:
            updated_at = state.get("updated_at")
            raise RuntimeError(
                f"Game tick stalled for >{TICK_STALL_SEC:.0f}s (tick={tick}, updated_at={updated_at}). "
                "Is the game-server running and connected to Redis?"
            )

        assignments = assign_coins_to_players(state, agent_ids)
        players = state.get("players") or {}

        for idx, agent_id in enumerate(agent_ids):
            player = players.get(agent_id)
            if not player:
                continue
            if agent_id in assignments:
                tx, ty, _cid = assignments[agent_id]
                direction = pick_direction_toward(player, tx, ty)
            else:
                # No coin to chase; drift to corners to reduce collisions.
                tx, ty = (0, 0) if idx == 0 else (width - 1, height - 1)
                direction = pick_direction_toward(player, tx, ty)
            send_input(lobby_id, api_keys_by_agent[agent_id], f"P{idx+1}", direction)

        time.sleep(0.11)
        if time.time() > deadline:
            # If the lobby isn't finishing, surface a useful error.
            ends_at_now = (state.get("ends_at") or "").strip()
            raise RuntimeError(
                f"Demo timed out before lobby finished (ends_at={ends_at_now or 'unknown'}). "
                "If ends_at is in the past but status never becomes FINISHED, the game loop is likely stalled."
            )


def wait_for_payout(lobby_id: str):
    deadline = time.time() + PAYOUT_WAIT_SEC
    while time.time() < deadline:
        output = run_cmd([
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-tA",
            "-c",
            f"SELECT id FROM payouts WHERE lobby_id = '{lobby_id}'",
        ])
        payout_id = output.strip()
        if payout_id:
            return payout_id
        time.sleep(0.5)
    raise RuntimeError(f"Payout not created within {PAYOUT_WAIT_SEC:.0f}s")

def wait_for_payout_execution(lobby_id: str, expected_coins: int):
    """
    Wait until the payout has been attempted (items SENT/FAILED) and (for non-zero payouts)
    at least one tx_hash exists. This matches the "instant payout on finish" behavior via
    the API worker.
    """
    exec_wait_sec = float(os.getenv("E2E_PAYOUT_EXEC_WAIT_SEC", "45"))
    deadline = time.time() + max(PAYOUT_WAIT_SEC, exec_wait_sec)
    payout_id = wait_for_payout(lobby_id)

    if expected_coins <= 0:
        return payout_id, 0, 0

    while time.time() < deadline:
        output = run_cmd([
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-tA",
            "-c",
            (
                "SELECT "
                "SUM(CASE WHEN status='SENT' THEN 1 ELSE 0 END)::int AS sent, "
                "SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END)::int AS failed, "
                "SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END)::int AS pending, "
                "SUM(CASE WHEN tx_hash IS NOT NULL AND tx_hash <> '' THEN 1 ELSE 0 END)::int AS hashed "
                f"FROM payout_items WHERE payout_id = '{payout_id}';"
            ),
        ])
        line = output.strip()
        if line:
            parts = line.split("|")
            if len(parts) >= 4:
                sent = int(parts[0] or 0)
                failed = int(parts[1] or 0)
                pending = int(parts[2] or 0)
                hashed = int(parts[3] or 0)
                # Consider execution "done" once all items have been attempted (no PENDING left).
                if pending == 0 and (hashed > 0 or (sent + failed) > 0):
                    return payout_id, sent, failed
        time.sleep(1.0)

    raise RuntimeError(f"Payout execution did not complete within timeout for lobby {lobby_id}")


def wait_for_tx_receipt(tx_hash: str):
    deadline = time.time() + TX_WAIT_SEC
    while time.time() < deadline:
        receipt = rpc_json("quai_getTransactionReceipt", [tx_hash])
        if receipt:
            return receipt
        time.sleep(2)
    raise RuntimeError(f"Transaction {tx_hash} not confirmed within {TX_WAIT_SEC:.0f}s")

def _parse_quai_amount(raw) -> float:
    try:
        return float(str(raw).strip())
    except Exception:
        return 0.0


def scale_scenario():
    """
    Large-scale load / payout demonstration.
    Default behavior is DRY RUN for payouts (does not send on-chain tx) unless E2E_SCALE_EXECUTE_PAYOUTS=1.
    """
    scale_lobbies = int(os.getenv("E2E_SCALE_LOBBIES", "10"))
    scale_players_per_lobby = int(os.getenv("E2E_SCALE_PLAYERS_PER_LOBBY", "10"))
    scale_fill_seconds = float(os.getenv("E2E_SCALE_FILL_SECONDS", "300"))
    scale_duration_sec = int(os.getenv("E2E_SCALE_DURATION_SEC", "60"))
    scale_coins_per_match = int(os.getenv("E2E_SCALE_COINS_PER_MATCH", "10"))
    scale_reward_pool_quai = os.getenv("E2E_SCALE_REWARD_POOL_QUAI", "10")
    scale_execute_payouts = os.getenv("E2E_SCALE_EXECUTE_PAYOUTS", "0") == "1"
    scale_input_every_ticks = int(os.getenv("E2E_SCALE_INPUT_EVERY_TICKS", "1"))
    scale_runners_per_lobby = int(os.getenv("E2E_SCALE_RUNNERS_PER_LOBBY", str(scale_players_per_lobby)))

    total_agents = scale_lobbies * scale_players_per_lobby
    join_interval = scale_fill_seconds / max(1, total_agents)

    log(
        "Scale config: "
        f"lobbies={scale_lobbies} players_per_lobby={scale_players_per_lobby} "
        f"fill_seconds={scale_fill_seconds:.0f} join_interval={join_interval:.2f}s "
        f"duration_sec={scale_duration_sec} coins_per_match={scale_coins_per_match} "
        f"reward_pool_quai={scale_reward_pool_quai} execute_payouts={int(scale_execute_payouts)} "
        f"input_every_ticks={scale_input_every_ticks}"
    )
    log(
        "Scale payout wallets: "
        f"A={AGENT_PAYOUT_ADDRESS} "
        f"B={AGENT2_PAYOUT_ADDRESS} "
        "(agents alternate A/B)"
    )
    if not scale_execute_payouts:
        log("Scale payouts: DRY RUN (no on-chain tx). Set E2E_SCALE_EXECUTE_PAYOUTS=1 to send transactions.")

    log(
        "Creating scale game mode... "
        f"max_players={scale_players_per_lobby} duration={scale_duration_sec}s "
        f"coins={scale_coins_per_match} reward_pool_quai={scale_reward_pool_quai}"
    )
    game_mode_id = create_game_mode(
        max_players=scale_players_per_lobby,
        duration_sec=scale_duration_sec,
        coins_per_match=scale_coins_per_match,
        reward_pool_quai=scale_reward_pool_quai,
    )

    lobbies = {}

    def assign_coins_to_players_any(state, agent_ids):
        coins = list(state.get("coins") or [])
        players = state.get("players") or {}
        if not coins or not agent_ids:
            return {}

        pairs = []
        for aid in agent_ids:
            p = players.get(aid)
            if not p:
                continue
            for coin in coins:
                try:
                    cx = int(coin["x"]); cy = int(coin["y"]); cid = int(coin["id"])
                except Exception:
                    continue
                dist = abs(cx - int(p["x"])) + abs(cy - int(p["y"]))
                pairs.append((dist, aid, cx, cy, cid))
        pairs.sort(key=lambda t: t[0])

        assigned_agents = set()
        assigned_coins = set()
        assignments = {}
        for _dist, aid, cx, cy, cid in pairs:
            if aid in assigned_agents or cid in assigned_coins:
                continue
            assignments[aid] = (cx, cy, cid)
            assigned_agents.add(aid)
            assigned_coins.add(cid)
            if len(assigned_coins) >= len(coins):
                break
        return assignments

    def ensure_lobby_record(lobby_id: str, watch_code: str, status: str):
        if lobby_id not in lobbies:
            lobbies[lobby_id] = {
                "lobby_id": lobby_id,
                "watch_code": watch_code,
                "status": status,
                "slot_to_api_key": {},
                "agent_id_to_api_key": {},
                "runners": [],
                "slot_to_agent_id": {},
                "targets": {},  # agent_id -> coin_id
                "last_tick_sent": {},
                "last_pos": {},  # agent_id -> (x,y)
                "last_move_tick": {},  # agent_id -> tick we last sent an input for
                "blocked_count": {},  # agent_id -> consecutive blocked moves
                "finished": False,
                "payout_checked": False,
                "payout_executed": False,
            }
        else:
            lobbies[lobby_id]["watch_code"] = watch_code or lobbies[lobby_id]["watch_code"]
            lobbies[lobby_id]["status"] = status or lobbies[lobby_id]["status"]
        return lobbies[lobby_id]

    def refresh_agent_id_mapping(lobby_id: str):
        record = lobbies.get(lobby_id)
        if not record:
            return
        try:
            _status, rows = http_json("GET", f"/lobbies/{lobby_id}/players")
        except Exception:
            return

        slot_to_agent_id = {}
        for row in rows:
            try:
                slot_to_agent_id[int(row["slot"])] = str(row["agent_id"])
            except Exception:
                continue

        record["slot_to_agent_id"] = slot_to_agent_id
        agent_id_to_slot = {}
        for slot, agent_id in slot_to_agent_id.items():
            agent_id_to_slot[agent_id] = slot
        record["agent_id_to_slot"] = agent_id_to_slot
        for slot, agent_id in slot_to_agent_id.items():
            api_key = record["slot_to_api_key"].get(slot)
            if api_key:
                record["agent_id_to_api_key"][agent_id] = api_key

        # Keep runners in sync as the lobby fills (otherwise we might lock in at 1 runner).
        runner_slots = sorted(record["slot_to_api_key"].keys())[:max(1, scale_runners_per_lobby)]
        record["runners"] = [slot_to_agent_id.get(s) for s in runner_slots if slot_to_agent_id.get(s)]
        record["last_map_refresh_at"] = time.time()

    def drive_active_lobbies():
        for lobby_id, record in lobbies.items():
            if record.get("finished"):
                continue
            payload = redis_get(f"lobby:{lobby_id}:state")
            if not payload or payload == "(nil)":
                continue
            try:
                state = json.loads(payload)
            except json.JSONDecodeError:
                continue

            status = state.get("status")
            record["status"] = status
            if status == "FINISHED":
                record["finished"] = True
                continue
            if status != "ACTIVE":
                continue

            # Refresh mapping periodically and while the lobby is still filling.
            expected_runners = min(scale_runners_per_lobby, len(record.get("slot_to_api_key") or {}))
            if (
                time.time() - float(record.get("last_map_refresh_at") or 0) > 2.0
                or len(record.get("runners") or []) < expected_runners
                or len(record.get("agent_id_to_api_key") or {}) < len(record.get("slot_to_api_key") or {})
            ):
                refresh_agent_id_mapping(lobby_id)
            runners = list(record.get("runners") or [])
            if not runners:
                continue

            tick = int(state.get("tick", 0) or 0)
            assignments = assign_coins_to_players_any(state, runners)
            players = state.get("players") or {}
            coins = list(state.get("coins") or [])
            occupied = set()
            for _aid, p in players.items():
                try:
                    occupied.add((int(p["x"]), int(p["y"])))
                except Exception:
                    continue
            coin_by_id = {}
            for coin in coins:
                try:
                    coin_by_id[int(coin["id"])] = (int(coin["x"]), int(coin["y"]))
                except Exception:
                    continue
            width = int(state.get("width", 1) or 1)
            height = int(state.get("height", 1) or 1)

            def next_xy(px: int, py: int, direction: str):
                if direction == "left":
                    return max(0, px - 1), py
                if direction == "right":
                    return min(width - 1, px + 1), py
                if direction == "up":
                    return px, max(0, py - 1)
                if direction == "down":
                    return px, min(height - 1, py + 1)
                return px, py

            def choose_direction(player, tx: int, ty: int, prefer_shuffle: bool):
                px = int(player["x"]); py = int(player["y"])
                dx = tx - px
                dy = ty - py
                primary = []
                if abs(dx) >= abs(dy):
                    if dx > 0: primary.append("right")
                    elif dx < 0: primary.append("left")
                    if dy > 0: primary.append("down")
                    elif dy < 0: primary.append("up")
                else:
                    if dy > 0: primary.append("down")
                    elif dy < 0: primary.append("up")
                    if dx > 0: primary.append("right")
                    elif dx < 0: primary.append("left")
                for d in ["up", "down", "left", "right"]:
                    if d not in primary:
                        primary.append(d)
                if prefer_shuffle:
                    import random
                    head = primary[:2]
                    tail = primary[2:]
                    random.shuffle(tail)
                    primary = head + tail
                # Avoid moving into currently occupied tiles when possible.
                for d in primary:
                    nx, ny = next_xy(px, py, d)
                    if (nx, ny) not in occupied:
                        return d
                return primary[0] if primary else "up"

            for agent_id in runners:
                api_key = record["agent_id_to_api_key"].get(agent_id)
                if not api_key:
                    continue
                last_sent = int(record["last_tick_sent"].get(agent_id, -999999))
                if tick - last_sent < scale_input_every_ticks:
                    continue
                player = players.get(agent_id)
                if not player:
                    continue

                # Detect "blocked" behavior: we sent an input on a previous tick, but position didn't change.
                px = int(player["x"]); py = int(player["y"])
                prev_pos = record.get("last_pos", {}).get(agent_id)
                last_move_tick = int(record.get("last_move_tick", {}).get(agent_id, -999999))
                blocked = bool(prev_pos == (px, py) and tick > last_move_tick and last_move_tick >= 0)
                if blocked:
                    record["blocked_count"][agent_id] = int(record["blocked_count"].get(agent_id, 0)) + 1
                else:
                    record["blocked_count"][agent_id] = 0

                # Prefer assigned coin; else keep a stable target coin; else drift toward a unique center offset.
                direction = None
                if agent_id in assignments:
                    tx, ty, cid = assignments[agent_id]
                    record["targets"][agent_id] = cid
                    direction = choose_direction(player, tx, ty, prefer_shuffle=blocked)
                else:
                    target_id = record["targets"].get(agent_id)
                    if target_id in coin_by_id:
                        tx, ty = coin_by_id[target_id]
                        direction = choose_direction(player, tx, ty, prefer_shuffle=blocked)
                    elif coins:
                        # Pick the nearest coin to look intelligent even when we couldn't uniquely assign.
                        best = None
                        best_dist = None
                        for coin in coins:
                            try:
                                cx = int(coin["x"]); cy = int(coin["y"]); cid = int(coin["id"])
                            except Exception:
                                continue
                            dist = abs(cx - int(player["x"])) + abs(cy - int(player["y"]))
                            if best is None or dist < best_dist:
                                best = (cx, cy, cid)
                                best_dist = dist
                        if best:
                            tx, ty, cid = best
                            record["targets"][agent_id] = cid
                            direction = choose_direction(player, tx, ty, prefer_shuffle=blocked)

                if direction is None:
                    # No coins to chase: sweep a per-slot slice of the grid to look "smart" and increase coverage.
                    slot = int((record.get("agent_id_to_slot") or {}).get(agent_id, 0))
                    slices = max(1, scale_players_per_lobby)
                    slice_start = (slot * width) // slices
                    slice_end = ((slot + 1) * width) // slices - 1
                    if slice_end < slice_start:
                        slice_end = slice_start

                    # Keep the agent inside its slice.
                    if int(player["x"]) < slice_start:
                        direction = choose_direction(player, slice_start, int(player["y"]), prefer_shuffle=blocked)
                    elif int(player["x"]) > slice_end:
                        direction = choose_direction(player, slice_end, int(player["y"]), prefer_shuffle=blocked)
                    else:
                        # Serpentine sweep: move horizontally within slice; when hitting an edge, step vertically.
                        hdir = record.setdefault("patrol_hdir", {}).get(agent_id)
                        vdir = record.setdefault("patrol_vdir", {}).get(agent_id)
                        if hdir not in (-1, 1):
                            hdir = 1 if (slot % 2 == 0) else -1
                        if vdir not in (-1, 1):
                            vdir = 1

                        next_x = int(player["x"]) + int(hdir)
                        if next_x < slice_start or next_x > slice_end:
                            # Flip horizontal direction and advance vertically.
                            hdir = -int(hdir)
                            next_y = int(player["y"]) + int(vdir)
                            if next_y < 0 or next_y >= height:
                                vdir = -int(vdir)
                                next_y = int(player["y"]) + int(vdir)
                                if next_y < 0 or next_y >= height:
                                    next_y = int(player["y"])
                            direction = choose_direction(player, int(player["x"]), next_y, prefer_shuffle=blocked)
                        else:
                            direction = choose_direction(player, next_x, int(player["y"]), prefer_shuffle=blocked)

                        record["patrol_hdir"][agent_id] = int(hdir)
                        record["patrol_vdir"][agent_id] = int(vdir)

                try:
                    http_json(
                        "POST",
                        f"/lobbies/{lobby_id}/input",
                        body={"direction": direction},
                        headers={"x-api-key": api_key},
                    )
                    record["last_tick_sent"][agent_id] = tick
                    record["last_move_tick"][agent_id] = tick
                    record["last_pos"][agent_id] = (px, py)
                except Exception:
                    continue

    def verify_lobby_results(lobby_id: str):
        record = lobbies.get(lobby_id)
        if not record or record.get("payout_checked"):
            return
        try:
            _status, res = http_json("GET", f"/lobbies/{lobby_id}/result")
        except Exception:
            return
        rows = res.get("results") or []

        total_coins = 0
        total_reward = 0.0
        mismatches = 0
        for row in rows:
            coins = int(row.get("final_coins") or 0)
            reward = _parse_quai_amount(row.get("final_reward_quai"))
            total_coins += coins
            total_reward += reward
            if abs(reward - float(coins)) > 1e-9:
                mismatches += 1

        log(
            f"Lobby {lobby_id} results: coins_collected={total_coins}/{scale_coins_per_match} "
            f"reward_sum={total_reward:.6f} mismatches={mismatches} players={len(rows)}"
        )
        record["payout_checked"] = True
        # Execution is handled separately so we can serialize and keep the "finish -> payout" flow consistent.

    def execute_lobby_payout_if_needed(lobby_id: str):
        record = lobbies.get(lobby_id)
        if not record or record.get("payout_executed"):
            return
        if not scale_execute_payouts:
            record["payout_executed"] = True
            return
        # Prefer instant payouts via the API worker (AUTO_PAYOUTS_ENABLED=1).
        if os.getenv("AUTO_PAYOUTS_ENABLED", "0") == "1":
            # We'll just verify completion; no manual /payouts/execute calls here to avoid blocking
            # agent driving and to match production behavior.
            try:
                _status, res = http_json("GET", f"/lobbies/{lobby_id}/result")
                total_coins = 0
                for row in (res.get("results") or []):
                    total_coins += int(row.get("final_coins") or 0)
                payout_id, sent, failed = wait_for_payout_execution(lobby_id, total_coins)
                log(f"Lobby {lobby_id} payout worker observed: payout_id={payout_id} sent={sent} failed={failed}")
                record["payout_executed"] = True
                return
            except Exception as exc:
                log(f"Lobby {lobby_id} payout worker wait failed; falling back to manual execute: {exc}")

        try:
            _status, res = http_json("GET", f"/lobbies/{lobby_id}/result")
        except Exception:
            return
        rows = res.get("results") or []
        total_coins = 0
        for row in rows:
            total_coins += int(row.get("final_coins") or 0)
        if total_coins <= 0:
            log(f"Lobby {lobby_id} payout skipped (0 coins collected => total_quai=0)")
            record["payout_executed"] = True
            return

        payout_id = wait_for_payout(lobby_id)
        log(f"Executing payout for lobby {lobby_id} ... {payout_id}")
        _status, execute = http_json("POST", "/payouts/execute", body={"lobby_id": lobby_id})
        sent = int(execute.get("sent", 0)) if isinstance(execute, dict) else int(execute.get("attempted", 0) or 0)
        failed = int(execute.get("failed", 0)) if isinstance(execute, dict) else 0
        log(f"Lobby {lobby_id} payout execute sent={sent} failed={failed}")
        record["payout_executed"] = True

    start = time.time()
    next_join_at = start
    for idx in range(total_agents):
        if time.time() < next_join_at:
            while time.time() < next_join_at:
                drive_active_lobbies()
                time.sleep(0.25)

        payout_address = AGENT_PAYOUT_ADDRESS if idx % 2 == 0 else AGENT2_PAYOUT_ADDRESS
        label = f"S{idx+1:03d}"
        api_key = register_agent(payout_address, label)

        _status, joined = http_json(
            "POST",
            "/lobbies/join",
            body={"game_mode_id": game_mode_id},
            headers={"x-api-key": api_key},
        )
        lobby_id = joined["lobby_id"]
        watch_code = joined.get("watch_code") or ""
        status = joined.get("status") or ""
        slot = int(joined.get("slot") or 0)

        is_new_lobby = lobby_id not in lobbies
        record = ensure_lobby_record(lobby_id, watch_code, status)
        if is_new_lobby and watch_code:
            log(f"UI: {WEB_URL}/#/watch/{game_mode_id}/{watch_code}")
        record["slot_to_api_key"][slot] = api_key
        refresh_agent_id_mapping(lobby_id)

        joined_count = len(record["slot_to_api_key"])
        log(
            f"Scale join {idx+1}/{total_agents}: lobby={watch_code or lobby_id[:8]} "
            f"slot={slot} joined={joined_count}/{scale_players_per_lobby} status={status}"
        )

        if status == "ACTIVE":
            refresh_agent_id_mapping(lobby_id)

        next_join_at += join_interval

    if len(lobbies) != scale_lobbies:
        codes = [rec.get("watch_code") or rec.get("lobby_id") for rec in lobbies.values()]
        raise RuntimeError(f"Expected {scale_lobbies} lobbies, but created {len(lobbies)}. Lobbies: {codes}")

    not_full = [
        (rec.get("watch_code") or rec.get("lobby_id"), len(rec.get("slot_to_api_key") or {}))
        for rec in lobbies.values()
        if len(rec.get("slot_to_api_key") or {}) != scale_players_per_lobby
    ]
    if not_full:
        raise RuntimeError(f"Some lobbies did not fill to {scale_players_per_lobby} players: {not_full}")

    log("Scale fill complete. Driving lobbies until all are finished...")
    # After fill, the last lobby may have just started. Give it duration + grace.
    hard_deadline = time.time() + scale_duration_sec + 180
    while time.time() < hard_deadline:
        drive_active_lobbies()
        finished = 0
        for lobby_id, record in lobbies.items():
            if record.get("finished"):
                finished += 1
                verify_lobby_results(lobby_id)
                execute_lobby_payout_if_needed(lobby_id)
        if finished >= scale_lobbies:
            log(f"All lobbies finished ({finished}/{scale_lobbies}).")
            break
        time.sleep(0.25)

    if any(not record.get("finished") for record in lobbies.values()):
        still = [rec.get("watch_code") or rec.get("lobby_id") for rec in lobbies.values() if not rec.get("finished")]
        raise RuntimeError(f"Scale scenario did not finish all lobbies before deadline. Remaining: {still}")

    # Ensure payout rows exist (helps debugging in DRY RUN mode).
    log("Scale post-phase: waiting for payout rows...")
    for lobby_id in lobbies.keys():
        payout_id = wait_for_payout(lobby_id)
        log(f"Lobby {lobby_id} payout ready: {payout_id}")


def main():
    if not TREASURY_PRIVATE_KEY:
        if SCENARIO == "scale" and os.getenv("E2E_SCALE_EXECUTE_PAYOUTS", "0") != "1":
            log("QUAI_TREASURY_PRIVATE_KEY not set; running scale scenario in DRY RUN mode (no on-chain payouts).")
        else:
            raise RuntimeError("QUAI_TREASURY_PRIVATE_KEY is required for chain payout test")

    log(
        "E2E timeouts: "
        f"coin_wait={COIN_WAIT_SEC}s "
        f"move={MOVE_TIMEOUT_SEC}s "
        f"stall={TICK_STALL_SEC}s "
        f"finish={FINISH_WAIT_SEC}s "
        f"payout={PAYOUT_WAIT_SEC}s "
        f"tx_wait={TX_WAIT_SEC}s "
        f"balance={BALANCE_WAIT_SEC}s"
    )
    log("Redis:" + f" {REDIS_HOST}:{REDIS_PORT} " + ("(docker exec fallback)" if REDIS_FORCE_DOCKER else "(socket preferred)"))

    log("Checking API health...")
    http_json("GET", "/health")

    if SCENARIO == "scale":
        scale_scenario()
        return

    api_key_1 = register_agent(AGENT_PAYOUT_ADDRESS, "P1")
    api_key_2 = None
    if PLAYER_COUNT >= 2:
        api_key_2 = register_agent(AGENT2_PAYOUT_ADDRESS, "P2")

    if DEMO_UI:
        completion_players = 2 if PLAYER_COUNT >= 2 else 1
        if completion_players != 2:
            raise RuntimeError("E2E_DEMO_UI=1 requires E2E_PLAYER_COUNT=2")

        coins = GAME_COINS_PER_MATCH if GAME_COINS_PER_MATCH > 0 else max(10, GAME_DURATION_SEC)
        log(f"Creating game mode for UI demo... players=2 duration={GAME_DURATION_SEC}s coins={coins}")
        game_mode_id = create_game_mode(max_players=2, duration_sec=GAME_DURATION_SEC, coins_per_match=coins)

        log("Joining lobby (demo run) as P1...")
        _, joined = http_json(
            "POST",
            "/lobbies/join",
            body={"game_mode_id": game_mode_id},
            headers={"x-api-key": api_key_1},
        )
        lobby_id = joined["lobby_id"]
        watch_code = joined.get("watch_code") or ""
        if watch_code:
            log(f"Watch code: {watch_code}")
            log(f"UI: {WEB_URL}/#/watch/{game_mode_id}/{watch_code}")
            log("Tip: You can also paste the watch code into Watch Live.")

        if JOIN_DELAY_SEC > 0:
            log(f"Waiting {JOIN_DELAY_SEC:.0f}s before P2 joins (so you can see WAITING)...")
            time.sleep(JOIN_DELAY_SEC)

        if not api_key_2:
            raise RuntimeError("E2E_DEMO_UI=1 requires P2 api key")
        log("Joining lobby (demo run) as P2...")
        http_json(
            "POST",
            "/lobbies/join",
            body={"game_mode_id": game_mode_id},
            headers={"x-api-key": api_key_2},
        )

        agent_ids = get_lobby_agent_ids_by_slot(lobby_id)
        if len(agent_ids) != 2:
            raise RuntimeError(f"Expected 2 agents in lobby, found {len(agent_ids)}")
        api_keys_by_agent = {agent_ids[0]: api_key_1, agent_ids[1]: api_key_2}

        log("Agents competing until lobby ends...")
        two_player_compete_until_finish(lobby_id, agent_ids, api_keys_by_agent)

        log("Waiting for lobby to finish...")
        wait_for_lobby_finish(lobby_id)

        payout_id = wait_for_payout(lobby_id)
        log(f"Executing payout... {payout_id}")

        before_1 = get_balance_wei(AGENT_PAYOUT_ADDRESS)
        before_2 = get_balance_wei(AGENT2_PAYOUT_ADDRESS)
        _, execute = http_json("POST", "/payouts/execute", body={"lobby_id": lobby_id})
        sent = int(execute.get("sent", 0)) if isinstance(execute, dict) else 0
        failed = int(execute.get("failed", 0)) if isinstance(execute, dict) else 0
        log(f"Payout execute sent={sent} failed={failed}")
        if sent == 0:
            failure = run_cmd([
                "docker",
                "compose",
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                POSTGRES_USER,
                "-d",
                POSTGRES_DB,
                "-tA",
                "-c",
                f"SELECT error FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'FAILED' LIMIT 1",
            ])
            raise RuntimeError(f"Payout failed: {failure.strip() or 'unknown error'}")

        tx_hashes_raw = run_cmd([
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-tA",
            "-c",
            f"SELECT tx_hash FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'SENT' ORDER BY attempted_at ASC",
        ])
        tx_hashes = [line.strip() for line in tx_hashes_raw.splitlines() if line.strip()]
        if not tx_hashes:
            raise RuntimeError("Payout sent but no tx_hash recorded")

        for h in tx_hashes:
            log(f"Waiting for tx confirmation... {h}")
            receipt = wait_for_tx_receipt(h)
            status = receipt.get("status") if isinstance(receipt, dict) else None
            if status not in ("0x1", "0x01", 1, True):
                raise RuntimeError(f"Transaction failed (status={status})")

        payout_rows = run_cmd([
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-tA",
            "-c",
            f"SELECT payout_address, amount_quai FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'SENT'",
        ])
        expected = {}
        for line in payout_rows.splitlines():
            line = line.strip()
            if not line:
                continue
            addr, amt = line.split("|", 1)
            expected[addr.strip().lower()] = quai_str_to_wei(amt.strip())

        log("Waiting for balance update...")
        deadline = time.time() + BALANCE_WAIT_SEC
        while time.time() < deadline:
            after_1 = get_balance_wei(AGENT_PAYOUT_ADDRESS)
            after_2 = get_balance_wei(AGENT2_PAYOUT_ADDRESS)
            ok_1 = after_1 - before_1 >= expected.get(AGENT_PAYOUT_ADDRESS.lower(), 1)
            ok_2 = after_2 - before_2 >= expected.get(AGENT2_PAYOUT_ADDRESS.lower(), 1)
            if ok_1 and ok_2:
                log(
                    "Balances increased: "
                    f"P1 {wei_to_quai(before_1)} -> {wei_to_quai(after_1)} "
                    f"P2 {wei_to_quai(before_2)} -> {wei_to_quai(after_2)}"
                )
                return
            time.sleep(2)

        raise RuntimeError(f"Balance did not increase within {BALANCE_WAIT_SEC:.0f}s")

    log("Creating game mode for leave test...")
    game_mode_id = create_game_mode(max_players=1, duration_sec=10, coins_per_match=1)

    log("Joining lobby (leave test)...")
    _, joined = http_json(
        "POST",
        "/lobbies/join",
        body={"game_mode_id": game_mode_id},
        headers={"x-api-key": api_key_1},
    )
    lobby_id = joined["lobby_id"]

    log("Leaving lobby...")
    http_json(
        "POST",
        "/lobbies/leave",
        body={"lobby_id": lobby_id},
        headers={"x-api-key": api_key_1},
    )

    log("Creating game mode for completion...")
    completion_players = 1 if PLAYER_COUNT < 2 else 2
    completion_coins = completion_players
    game_mode_id = create_game_mode(max_players=completion_players, duration_sec=10, coins_per_match=completion_coins)

    log("Joining lobby (completion run)...")
    _, joined = http_json(
        "POST",
        "/lobbies/join",
        body={"game_mode_id": game_mode_id},
        headers={"x-api-key": api_key_1},
    )
    lobby_id = joined["lobby_id"]

    if completion_players == 2:
        if not api_key_2:
            raise RuntimeError("E2E_PLAYER_COUNT=2 but P2 api key missing")
        # Second join should attach to the same WAITING lobby and activate it.
        http_json(
            "POST",
            "/lobbies/join",
            body={"game_mode_id": game_mode_id},
            headers={"x-api-key": api_key_2},
        )

        agent_ids = get_lobby_agent_ids_by_slot(lobby_id)
        if len(agent_ids) != 2:
            raise RuntimeError(f"Expected 2 agents in lobby, found {len(agent_ids)}")
        api_keys_by_agent = {agent_ids[0]: api_key_1, agent_ids[1]: api_key_2}

        log("Exploring grid to collect 1 coin each...")
        two_player_collect_one_each(lobby_id, agent_ids, api_keys_by_agent)
    else:
        log("Exploring grid to find coin...")
        explore_for_coin(lobby_id, api_key_1)

    log("Waiting for lobby to finish...")
    wait_for_lobby_finish(lobby_id)

    payout_id = wait_for_payout(lobby_id)
    log(f"Executing payout... {payout_id}")

    before_1 = get_balance_wei(AGENT_PAYOUT_ADDRESS)
    before_2 = get_balance_wei(AGENT2_PAYOUT_ADDRESS) if completion_players == 2 else None
    _, execute = http_json("POST", "/payouts/execute", body={"lobby_id": lobby_id})
    sent = int(execute.get("sent", 0)) if isinstance(execute, dict) else 0
    failed = int(execute.get("failed", 0)) if isinstance(execute, dict) else 0
    log(f"Payout execute sent={sent} failed={failed}")
    if sent == 0:
        failure = run_cmd([
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-tA",
            "-c",
            f"SELECT error FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'FAILED' LIMIT 1",
        ])
        raise RuntimeError(f"Payout failed: {failure.strip() or 'unknown error'}")

    # Pull all sent tx hashes (one per payout item). For 2 players we expect 2 txs.
    tx_hashes_raw = run_cmd([
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-tA",
        "-c",
        f"SELECT tx_hash FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'SENT' ORDER BY attempted_at ASC",
    ])
    tx_hashes = [line.strip() for line in tx_hashes_raw.splitlines() if line.strip()]
    if not tx_hashes:
        raise RuntimeError("Payout sent but no tx_hash recorded")

    for h in tx_hashes:
        log(f"Waiting for tx confirmation... {h}")
        receipt = wait_for_tx_receipt(h)
        status = receipt.get("status") if isinstance(receipt, dict) else None
        if status not in ("0x1", "0x01", 1, True):
            raise RuntimeError(f"Transaction failed (status={status})")

    # Read expected payout amounts from DB to validate both on-chain deltas.
    payout_rows = run_cmd([
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-tA",
        "-c",
        f"SELECT payout_address, amount_quai FROM payout_items WHERE payout_id = '{payout_id}' AND status = 'SENT'",
    ])
    expected = {}
    for line in payout_rows.splitlines():
        line = line.strip()
        if not line:
            continue
        addr, amt = line.split("|", 1)
        expected[addr.strip().lower()] = quai_str_to_wei(amt.strip())

    log("Waiting for balance update...")
    deadline = time.time() + BALANCE_WAIT_SEC
    while time.time() < deadline:
        after_1 = get_balance_wei(AGENT_PAYOUT_ADDRESS)
        ok_1 = after_1 - before_1 >= expected.get(AGENT_PAYOUT_ADDRESS.lower(), 1)

        ok_2 = True
        after_2 = None
        if completion_players == 2 and before_2 is not None:
            after_2 = get_balance_wei(AGENT2_PAYOUT_ADDRESS)
            ok_2 = after_2 - before_2 >= expected.get(AGENT2_PAYOUT_ADDRESS.lower(), 1)

        if ok_1 and ok_2:
            if completion_players == 2 and after_2 is not None:
                log(
                    "Balances increased: "
                    f"P1 {wei_to_quai(before_1)} -> {wei_to_quai(after_1)} "
                    f"P2 {wei_to_quai(before_2)} -> {wei_to_quai(after_2)}"
                )
            else:
                log(f"Balance increased: {wei_to_quai(before_1)} -> {wei_to_quai(after_1)}")
            return
        time.sleep(2)

    raise RuntimeError(f"Balance did not increase within {BALANCE_WAIT_SEC:.0f}s")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("E2E chain test failed:", exc)
        sys.exit(1)

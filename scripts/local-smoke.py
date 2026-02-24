#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

API_URL = os.getenv("API_URL", "http://localhost:3001").rstrip("/")
POSTGRES_USER = os.getenv("POSTGRES_USER", "qlympics")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "qlympics")
POSTGRES_DB = os.getenv("POSTGRES_DB", "qlympics")
POW_MAX_ITERS = int(os.getenv("POW_MAX_ITERS", "500000"))


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
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload)
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8")
        raise RuntimeError(f"HTTP {exc.code} {url}: {payload}") from exc


def solve_pow(nonce: str, difficulty: int):
    target = "0" * difficulty
    for i in range(POW_MAX_ITERS):
        solution = f"sol-{i}"
        digest = hashlib.sha256(f"{nonce}:{solution}".encode("utf-8")).hexdigest()
        if digest.startswith(target):
            return solution, i + 1
    raise RuntimeError(f"Failed to solve PoW in {POW_MAX_ITERS} iterations. Increase POW_MAX_ITERS or reduce difficulty.")


def run_cmd(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def create_game_mode():
    sql = (
        "INSERT INTO game_modes (title, max_players, duration_sec, coins_per_match, reward_pool_quai, status) "
        "VALUES ('Coin Runner', 2, 120, 100, 10.0, 'ACTIVE') RETURNING id;"
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


def redis_get(key: str):
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


def main():
    print("Checking API health...")
    status, health = http_json("GET", "/health")
    if status != 200:
        raise RuntimeError("API health check failed")
    print("API healthy:", health)

    print("Requesting PoW challenge...")
    _, challenge = http_json("POST", "/agents/challenge", body={})
    challenge_id = challenge["challenge_id"]
    nonce = challenge["nonce"]
    difficulty = int(challenge["difficulty"])
    print(f"Challenge {challenge_id} difficulty {difficulty}")

    print("Solving PoW...")
    solution, attempts = solve_pow(nonce, difficulty)
    print(f"Solved PoW in {attempts} attempts")

    print("Verifying and requesting api_key...")
    _, verify = http_json(
        "POST",
        "/agents/verify",
        body={
            "challenge_id": challenge_id,
            "solution": solution,
            "payout_address": "0xSmokeWallet",
            "runtime_identity": "smoke",
            "name": "Smoke Agent",
            "version": "v1",
        },
    )
    api_key = verify["api_key"]
    agent_id = verify["agent_id"]
    print("Agent created:", agent_id)

    print("Creating game mode...")
    game_mode_id = create_game_mode()
    print("Game mode:", game_mode_id)

    print("Joining lobby...")
    _, joined = http_json(
        "POST",
        "/lobbies/join",
        body={"game_mode_id": game_mode_id},
        headers={"x-api-key": api_key},
    )
    lobby_id = joined["lobby_id"]
    print("Lobby:", lobby_id, "watch_code:", joined.get("watch_code"))

    print("Sending input...")
    _, input_resp = http_json(
        "POST",
        f"/lobbies/{lobby_id}/input",
        body={"direction": "up"},
        headers={"x-api-key": api_key},
    )
    print("Input response:", input_resp)

    print("Waiting for game server to process...")
    for _ in range(10):
        state_raw = redis_get(f"lobby:{lobby_id}:state")
        seq_raw = redis_get(f"lobby:{lobby_id}:seq")
        if state_raw and state_raw != "(nil)":
            print("State:", json.loads(state_raw))
            print("Seq:", seq_raw)
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Lobby state not found in Redis. Is the game server running?")

    print("Smoke test complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Smoke test failed:", exc)
        sys.exit(1)

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const Redis = require("ioredis");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const redis = new Redis(); // Connects to local Redis server

const LOCK_KEY = "keyboard_lock";
const KEYS_STATE = "keyboard_state";

const DEFAULT_KEYS = Array(10).fill("white");

// Store initial keyboard state in Redis
redis.set(KEYS_STATE, JSON.stringify(DEFAULT_KEYS));

io.on("connection", async (socket) => {
	const userId = socket.handshake.query.userId;
	console.log(`User ${userId} connected with socket ID: ${socket.id}`);

	// Send the latest keyboard state to the user
	const keys = JSON.parse(await redis.get(KEYS_STATE)) || DEFAULT_KEYS;
	socket.emit("updateKeys", keys);

	// Send current lock owner
	const lockOwner = await redis.get(LOCK_KEY);
	socket.emit("controlGranted", lockOwner);

	// Acquire Control
	socket.on("acquireControl", async (_, callback) => {
		const lockOwner = await redis.get(LOCK_KEY);

		if (!lockOwner) {
			await redis.set(LOCK_KEY, userId, "EX", 120); // Lock expires in 12 seconds
			io.emit("controlGranted", userId);
			console.log(`User ${userId} acquired control`);
			callback({ success: true });

			// Schedule auto-release of control after 12 seconds
			setTimeout(async () => {
				const currentLock = await redis.get(LOCK_KEY);
				if (currentLock === userId) {
					await redis.del(LOCK_KEY);
					io.emit("controlReleased");
					console.log(
						`User ${userId} control auto-released after 120 seconds`
					);
				}
			}, 120000);
		} else {
			callback({ success: false, ownerId: lockOwner });
		}
	});

	// Handle Key Clicks
	socket.on("updateKeys", async ({ userId, newKeys }) => {
		const lockOwner = await redis.get(LOCK_KEY);

		if (lockOwner !== userId) {
			socket.emit("controlDenied", "You don't have control!");
			return;
		}

		await redis.set(KEYS_STATE, JSON.stringify(newKeys));
		io.emit("updateKeys", newKeys);
		console.log(`User ${userId} updated keys`);

		// Release control immediately after clicking
		await redis.del(LOCK_KEY);
		io.emit("controlReleased");
	});

	// Handle Disconnect
	socket.on("disconnect", async () => {
		console.log(`User ${userId} disconnected`);
		const lockOwner = await redis.get(LOCK_KEY);

		if (lockOwner === userId) {
			await redis.del(LOCK_KEY);
			io.emit("controlReleased");
			console.log(`User ${userId} control released on disconnect`);
		}
	});
});

// Start Server
server.listen(5000, () => {
	console.log("Server running on http://localhost:5000");
});

Scribble Clone - Full Project (with Custom Words)

How to run:
1. npm install
2. npm start
3. Open http://localhost:3000

Features:
- Rooms with host (create/join by code)
- Host controls: kick, start, pause, settings
- Custom words (host can enter comma-separated words in Settings)
- 3-word choice for drawer (custom words prioritized)
- Languages: English, Hindi; categories: objects, animals, food
- Smooth strokes, undo, replay
- Persistent rounds & leaderboard using SQLite

Files:
- server.js : Node + Socket.IO server
- public/* : client files

<img width="852" height="577" alt="linkedin-suki-szn" src="https://github.com/user-attachments/assets/4672a5a6-64f7-4af7-b866-324a40c09b77" />

# 🚀 Galactic Wars

A high-performance, real-time multiplayer space combat game built with Phaser 3, Node.js, and Socket.io. The engine features a robust authoritative server model, persistent player data via Supabase, and a custom-built synchronization layer to handle high-latency environments.

## 🛠 Tech Stack

Frontend: Phaser 3 (Canvas/WebGL), TypeScript, Vite.

Backend: Node.js, Express, Socket.io (WebSockets).

Persistence: Supabase (PostgreSQL) for user profiles and global leaderboards.

Auth: Firebase Authentication & Google OAuth.

Infrastructure: Distributed architecture with specialized "Survival Room" managers.

## ✨ Key Features

Dual Game Modes: * Multiplayer: Global free-for-all arena.

Survival: Session-based lobby system with private rooms and persistent state.

Authoritative Server: Client-side prediction with server-side validation for movement, combat, and collision detection to prevent cheating.

Dynamic Room Management: Automated lifecycle management for game instances, including host migration and cleanup.

Persistent Progression: Real-time synchronization of kills, deaths, and rankings with a cloud database.

## 🚦 Getting Started

### Prerequisites

Node.js (v18+)

Firebase Project (for Auth)

Supabase Instance (for DB)

### Installation

Clone the repo: git clone [your-repo-url]

Install dependencies: npm install

Set up .env with your Firebase and Supabase credentials.

Run development: npm run dev

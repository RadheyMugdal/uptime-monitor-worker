# Uptime Monitor - Check Worker

This is the background worker service for the Uptime Monitor project. It is responsible for performing the actual uptime checks (HTTP/HTTPS) and processing jobs from the queue.

## 🛠️ Tech Stack

-   **Runtime**: Node.js
-   **Queue System**: BullMQ
-   **Storage**: Redis
-   **HTTP Client**: Axios
-   **Database ORM**: Drizzle ORM (Shared database with the web app)

## 🚀 Getting Started

### Prerequisites

-   Node.js (v18+)
-   [Bun](https://bun.sh/) (Used for running TypeScript scripts)
-   Redis Server (Required for BullMQ)
-   PostgreSQL database

### Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Set up environment variables:
    Create a `.env` file in this directory.
    
    Required variables:
    ```env
    DATABASE_URL="postgresql://..."
    REDIS_URL="redis://localhost:6379"
    ```

### Development

Start the worker in development mode:

```bash
npm run dev
```
This uses `bunx tsx watch` to run the worker with hot reloading.

### Production

To build and start the worker for production:

```bash
npm run build
npm start
```

## 📜 Scripts

-   `dev`: Run the worker in watch mode.
-   `build`: Compile TypeScript to JavaScript.
-   `start`: Run the compiled worker.

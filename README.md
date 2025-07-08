# Home Security Web App

A Node.js-based web application for managing home security camera uploads, user authentication via Google OAuth, and real-time notifications using MQTT. The app integrates with Google Drive for file storage and MongoDB for user and camera management.

## Features

- **Google OAuth2 Authentication**: Secure user login and session management.
- **Camera Management**: Add, list, and delete cameras for each user.
- **File Uploads**: Upload camera event files to Google Drive, organized by date.
- **Face Management**: Upload and associate face images with cameras.
- **File Retention**: Mark files to retain or undo retention.
- **Download Files**: Download individual or paginated files by date.
- **MQTT Notifications**: Real-time notifications for new uploads.
- **Session Restore**: Restore user sessions and camera lists.
- **Weekly Cleanup (optional)**: (Commented out) Scheduled cleanup of non-retained files.

## Tech Stack

- **Node.js** & **Express**: Backend server.
- **MongoDB** & **Mongoose**: Database and ORM.
- **Google Drive API**: File storage.
- **Google OAuth2**: Authentication.
- **MQTT**: Real-time notifications.
- **Multer**: File uploads.
- **CORS**: Cross-origin resource sharing.
- **Node-cron**: Scheduled tasks.

## Dependencies

- [@google-cloud/storage](https://www.npmjs.com/package/@google-cloud/storage) (for Google Drive integration)
- [bcryptjs](https://www.npmjs.com/package/bcryptjs) (for password hashing)
- [cors](https://www.npmjs.com/package/cors)
- [dotenv](https://www.npmjs.com/package/dotenv) (for environment variables)
- [googleapis](https://www.npmjs.com/package/googleapis)
- [mongoose](https://www.npmjs.com/package/mongoose)
- [mqtt](https://www.npmjs.com/package/mqtt)
- [multer](https://www.npmjs.com/package/multer)
- [node-cron](https://www.npmjs.com/package/node-cron)
- [nodemon](https://www.npmjs.com/package/nodemon) (for development, auto-restarts the server)
- [uuid](https://www.npmjs.com/package/uuid) (for generating unique IDs)

## Setup

1. **Clone the repository**  
   ```sh
   git clone <repo-url>
   cd NodejsWebApp1/NodejsWebApp1
   ```

2. **Install dependencies**  
   ```sh
   npm install
   ```

3. **Configure Environment**  
   - Set your Google OAuth credentials (`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`) in `server.js`.
   - Update MongoDB connection string if needed.
   - Set MQTT broker details if using a different broker.
   - Create a `.env` file in the root directory and add your environment variables (refer to `.env.example`).

4. **Run the server**  
   ```sh
   npm start
   ```
   The server runs on port `3001` by default.

## API Endpoints

- `POST /auth/google` — Authenticate user via Google OAuth2.
- `POST /upload` — Upload a camera event file.
- `POST /add-camera` — Add a new camera.
- `POST /list-cameras` — List all cameras for a user.
- `POST /delete-camera` — Delete a camera.
- `POST /add-face` — Upload a face image for recognition.
- `POST /retain-file` — Mark a file to retain.
- `POST /undo-retain-file` — Undo file retention.
- `POST /restore-session` — Restore user session and camera list.
- `GET /download-file` — Download a specific file.
- `GET /download-files` — Download paginated files for a date.

## Folder Structure

- `server.js` — Main server file.
- `models/User.js` — Mongoose user schema.
- `uploads/` — Temporary upload storage.
- `HomeSecurity/` — (Google Drive folder, not local).

## Notes

- Ensure your Google OAuth2 credentials and redirect URIs are set up correctly in the Google Cloud Console.
- The weekly cleanup cron job is present but commented out; enable it as needed.
- MQTT broker must support WebSockets for real-time notifications.

## License

MIT



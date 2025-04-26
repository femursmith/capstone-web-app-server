const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const multer = require("multer");
const cron = require("node-cron");
const fs = require("fs");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const User = require("./models/User");

const upload = multer({ dest: "uploads/" });
mongoose.connect("mongodb+srv://aduwilsonk:F63kbfd2lLZC3g1V@capstone-test-1.jiuj5.mongodb.net/?retryWrites=true&w=majority&appName=Capstone-Test-1", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});



const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = '417872578564-surfmu1m0nst8hpsfj0r6l0rcgbgs3uf.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
// Ensure that your REDIRECT_URI here matches the one you set in your OAuth credentials and on the client
const REDIRECT_URI = 'http://localhost:3000';

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

const getDriveInstance = (accessToken) => {
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.drive({ version: "v3", auth: oauth2Client });
};


const MQTT_BROKER_URL = "wss://d457c1d9.ala.eu-central-1.emqxsl.com:8084/mqtt";
const MQTT_USERNAME = "server";
const MQTT_PASSWORD = "server";

const options = {
  keepalive: 600,
  clientId: "server",
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 4000,
  rejectUnauthorized: false,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  protocol: 'wss',
  port: parseInt(MQTT_BROKER_URL.split(":")[2]) || 8084,
};

const mqttClient = mqtt.connect(MQTT_BROKER_URL, options);

// Add event listeners for debugging:
mqttClient.on("connect", () => {
  console.log("MQTT connected");
});

mqttClient.on("reconnect", () => {
  console.log("MQTT reconnecting...");
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err);
});

mqttClient.on("close", () => {
  console.log("MQTT connection closed");
});


app.post('/auth/google', async (req, res) => {
  const { code, code_verifier } = req.body;
  if (!code || !code_verifier) {
      return res.status(400).json({ error: 'Missing code or code_verifier' });
  }

  try {
      // Exchange the authorization code for tokens (include PKCE code_verifier)
      const { tokens } = await oauth2Client.getToken({
          code: code,
          codeVerifier: code_verifier,
          redirect_uri: REDIRECT_URI,
      });

    

      // Set the credentials on the OAuth2 client
      oauth2Client.setCredentials(tokens);

      // Retrieve user information from Google
      const userInfoResponse = await google.oauth2('v2').userinfo.get({ auth: oauth2Client });
      const userData = userInfoResponse.data;

      // Extract necessary fields
      const googleId = userData.id;
      const firstName = userData.given_name;
      const lastName = userData.family_name;

      // Update or create the user in the database
      const user = await User.findOneAndUpdate(
          { googleId },
          {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: new Date(Date.now() + 3600 * 1000),
              firstName,
              lastName,
              $setOnInsert: { uploads: [] } // Initialize uploads if user is new
          },
          { upsert: true, new: true }
      );

      // Retrieve camera names from the user's data
      const cameraNames = user.cameras ? user.cameras.map(cam => cam.cameraName) : [];

      // Respond with user details and camera names
      res.json({
          userId: googleId,
          firstName,
          lastName,
          cameras: cameraNames
      });

  } catch (error) {
      console.error(error.response ? error.response.data : error.message);
      res.status(500).json({ error: 'Authentication failed' });
  }
});
  


// Connect to your MQTT broker (adjust options and URL as needed)


  app.post("/upload", upload.single("file"), async (req, res) => {  
    try {
      // Extract required fields from the request body.
      const { userId, cameraId, event } = req.body;
      if (!userId || !cameraId || !event) {
        return res.status(400).json({ error: "User ID, cameraId, and event are required" });
      }

      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Look up the camera object (with cameraName) in the user's cameras array.
      const cameraObj = user.cameras.find((cam) => cam.cameraId === cameraId);
      if (!cameraObj) {
        return res.status(403).json({ error: "Unauthorized camera" });
      }

      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
      });

      // Refresh token if expired
      if (new Date() > user.expiresAt) {
        const { credentials } = await oauth2Client.refreshAccessToken();
        user.accessToken = credentials.access_token;
        // Update expiration (assuming 3600 seconds validity)
        user.expiresAt = new Date(Date.now() + 3600 * 1000);
        await user.save();
      }

      oauth2Client.setCredentials({ access_token: user.accessToken });
      const drive = google.drive({ version: "v3", auth: oauth2Client });

      // Helper function to get or create a folder by name (optionally within a parent folder)
      async function getOrCreateFolder(folderName, parentId) {
        let q = "name = '" + folderName + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        if (parentId) {
          q += " and '" + parentId + "' in parents";
        }
        const folderList = await drive.files.list({
          q,
          fields: "files(id, name)",
        });
        if (folderList.data.files && folderList.data.files.length > 0) {
          return folderList.data.files[0].id;
        } else {
          const fileMetadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          };
          if (parentId) {
            fileMetadata.parents = [parentId];
          }
          const folder = await drive.files.create({
            requestBody: fileMetadata,
            fields: "id",
          });
          return folder.data.id;
        }
      }

      // Get or create "HomeSecurity" folder.
      const homeFolderId = await getOrCreateFolder("HomeSecurity");

      // Get current date string in "DD-M-YYYY" format.
      let today = new Date();
      let dateStr = today.getDate() + "-" + (today.getMonth() + 1) + "-" + today.getFullYear();

      // Get or create subfolder for the current date within HomeSecurity.
      const dateFolderId = await getOrCreateFolder(dateStr, homeFolderId);

      // Upload file into the date folder.
      const fileMetadata = {
        name: req.file.originalname,
        parents: [dateFolderId],
      };
      const media = {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path),
      };

      const driveResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id",
      });

      fs.unlinkSync(req.file.path); // Cleanup temporary file

      // Create a file record with fileId, current time, cameraId, and event.
      const newFileRecord = {
        fileId: driveResponse.data.id,
        time: new Date(),
        cameraId,
        event,
      };

      // Update the user's uploads: check if an entry for today's date exists.
      const dateEntryIndex = user.uploads.findIndex(entry => entry.date === dateStr);
      if (dateEntryIndex >= 0) {
        user.uploads[dateEntryIndex].files.push(newFileRecord);
      } else {
        user.uploads.push({
          date: dateStr,
          files: [newFileRecord],
        });
      }

      await user.save();

      // Build the response object (note: returning cameraName instead of cameraId)
      const responseData = { 
        fileId: driveResponse.data.id, 
        time: newFileRecord.time, 
        cameraName: cameraObj.cameraName, 
        event 
      };

      // Check that the client is connected before publishing
      if (mqttClient.connected) {
        mqttClient.publish(`${userId}/notification`, JSON.stringify(responseData));
        console.log(`Published to ${userId}/notification`);
      } else {
        console.error("MQTT client not connected. Unable to publish.");
      }

      // Also send the response back to the client.
      res.json(responseData);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });
  
  
  
  app.post("/restore-session", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "User ID is required" });
  
      const user = await User.findOne({ googleId: userId });
      if (!user) return res.status(401).json({ error: "User not found" });
  
      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
      });
  
      // Refresh access token if expired.
      if (new Date() > user.expiresAt) {
        const { credentials } = await oauth2Client.refreshAccessToken();
        user.accessToken = credentials.access_token;
        user.expiresAt = new Date(Date.now() + 3600 * 1000);
        await user.save();
      }

      const cameraNames = user.cameras.map(cam => cam.cameraName);

      console.log(cameraNames);
  
      // Return userId and cameras array.
      res.json({ userId: user.googleId, cameras: cameraNames });
    } catch (error) {
      console.error("Session restore error:", error);
      res.status(500).json({ error: "Failed to restore session" });
    }
  });

  app.post("/delete-camera", async (req, res) => {
    try {
      const { userId, cameraName } = req.body;
      if (!userId || !cameraName) {
        return res.status(400).json({ error: "userId and cameraName are required" });
      }
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      // Filter out the camera with the given cameraName.
      const originalLength = user.cameras.length;
      user.cameras = user.cameras.filter(cam => cam.cameraName !== cameraName);
  
      if (user.cameras.length === originalLength) {
        // No camera was removed.
        return res.status(404).json({ error: "Camera not found", cameras: user.cameras.map(cam => cam.cameraName) });
      }
  
      await user.save();
  
      res.json({ message: "Camera deleted successfully", cameras: user.cameras.map(cam => cam.cameraName) });
    } catch (error) {
      console.error("Delete camera error:", error);
      res.status(500).json({ error: "Failed to delete camera" });
    }
  });
  
  app.post("/list-cameras", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
  
      // Find the user by their googleId (which you're calling userId on the client side)
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      // Map each camera object to return only the cameraId and cameraName
      const cameraList = user.cameras.map(cam => ({
        cameraId: cam.cameraId,
        cameraName: cam.cameraName,
      }));
  
      return res.json({ cameras: cameraList });
    } catch (error) {
      console.error("List cameras error:", error);
      res.status(500).json({ error: "Failed to retrieve cameras" });
    }
  });
  

app.post("/add-camera", async (req, res) => {
    try {
      const { userId, cameraId, cameraName } = req.body;
      if (!userId || !cameraId || !cameraName) {
        return res.status(400).json({ error: "userId, cameraId, and cameraName are required" });
      }
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      // Check if the camera already exists in the cameras array.
      const cameraExists = user.cameras.some(cam => cam.cameraId === cameraId);
      if (cameraExists) {
        return res.json({ message: "Camera already added", cameras: user.cameras.map(cam => cam.cameraName) });
      }
  
      // Add the new camera as an object with cameraId and cameraName.
      user.cameras.push({ cameraId, cameraName });
      await user.save();
  
      res.json({ message: "Camera added successfully", cameras: user.cameras.map(cam => cam.cameraName) });
    } catch (error) {
      console.error("Add camera error:", error);
      res.status(500).json({ error: "Failed to add camera" });
    }
  });
  
  


app.get("/download-file", async (req, res) => {
    const { fileId, userId } = req.query;

    if (!fileId || !userId) {
        return res.status(400).json({ error: "Missing fileId or userId" });
    }

    try {
        // Simulate getting user access token from DB (replace with real logic)
        const user = await User.findOne({ googleId: userId });
        if (!user) {
            return res.status(401).json({ error: "User not found" });
        }

        oauth2Client.setCredentials({ access_token: user.accessToken, refresh_token: user.refreshToken });

        // 🔹 Refresh access token if expired
        if (new Date() > user.expiresAt) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            user.accessToken = credentials.access_token;
            user.expiresAt = new Date(Date.now() + 3600);
            await user.save();
        }

       

        const drive = getDriveInstance(user.accessToken);

        // 🔹 Fetch file metadata to get MIME type
        const fileMeta = await drive.files.get({ fileId, fields: "mimeType" });
        const mimeType = fileMeta.data.mimeType;

        // 🔹 Stream file to client
        const fileStream = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });

        res.setHeader("Content-Type", mimeType);
        fileStream.data.pipe(res);
    } catch (error) {
        console.error("Error fetching file:", error);
        res.status(500).json({ error: "Failed to fetch file" });
    }
});

app.get("/download-files", async (req, res) => { 
    try {
      const { userId, date, page } = req.query;
      if (!userId || !date) {
        return res.status(400).json({ error: "userId and date are required" });
      }
  
      // Use page parameter if provided; default to 1
      const pageNumber = page ? parseInt(page) : 1;
      const pageSize = 10;
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      // Find the uploads entry for the specified date
      const uploadEntry = user.uploads.find((entry) => entry.date === date);
      if (!uploadEntry) {
        return res.status(404).json({ error: "No uploads found for the given date" });
      }
  
      // Sort the files from most recent to oldest
      const sortedFiles = uploadEntry.files.sort(
        (a, b) => new Date(b.time) - new Date(a.time)
      );
  
      // Calculate pagination
      const totalFiles = sortedFiles.length;
      const totalPages = Math.ceil(totalFiles / pageSize);
      const startIndex = (pageNumber - 1) * pageSize;
      const paginatedFiles = sortedFiles.slice(startIndex, startIndex + pageSize);
  
      // Build a map of cameraId to cameraName from the user's cameras array.
      // Assuming user.cameras is an array of objects: { cameraId, cameraName }
      const cameraMap = {};
      if (user.cameras && Array.isArray(user.cameras)) {
        user.cameras.forEach((cam) => {
          cameraMap[cam.cameraId] = cam.cameraName;
        });
      }
  
      // Map the paginated files to include cameraName instead of cameraId.
      const modifiedFiles = paginatedFiles.map((file) => {
        // Look up the cameraName for this file's cameraId.
        const camName = cameraMap[file.cameraId] ;
        return {
          ...file._doc ? file._doc : file, // In case file is a Mongoose document
          cameraName: camName,
        };
      });
  
      res.json({
        page: pageNumber,
        totalPages,
        totalFiles,
        accessToken: user.accessToken,
        files: modifiedFiles,
      });
    } catch (error) {
      console.error("Download files error:", error);
      res.status(500).json({ error: "Failed to download files" });
    }
  });
  
  
// Runs at 00:00 every Monday
cron.schedule("0 0 * * 1", async () => {
    console.log("Weekly cleanup task started...");
  
    try {
      // Find all users
      const allUsers = await User.find({});
      for (const user of allUsers) {
        // Refresh token if needed
        if (new Date() > user.expiresAt) {
          const { credentials } = await oauth2Client.refreshAccessToken();
          user.accessToken = credentials.access_token;
          // Update expiration if needed
          user.expiresAt = new Date(Date.now() + 3600 * 1000);
          await user.save();
        }
  
        // Set credentials for the Drive client
        oauth2Client.setCredentials({
          access_token: user.accessToken,
          refresh_token: user.refreshToken,
        });
        const drive = google.drive({ version: "v3", auth: oauth2Client });
  
        // We'll collect the fileIds to delete from user.uploads
        const fileIdsToDelete = [];
  
        // Also, we’ll remove them from the user’s uploads array
        // but we need to do it carefully to avoid mutating while iterating
        user.uploads.forEach((uploadEntry) => {
          // Filter out non-retained files
          uploadEntry.files = uploadEntry.files.filter((file) => {
            if (!file.retain) {
              // Mark file for deletion
              fileIdsToDelete.push(file.fileId);
              return false; // remove from user
            }
            return true; // keep
          });
        });
  
        // Now remove empty upload entries if needed
        user.uploads = user.uploads.filter(
          (entry) => entry.files.length > 0
        );
  
        // Delete from Drive
        for (const fileId of fileIdsToDelete) {
          try {
            await drive.files.delete({ fileId });
            console.log(`Deleted fileId: ${fileId} from Drive`);
          } catch (err) {
            console.error(`Error deleting file ${fileId}:`, err);
          }
        }
  
        // Save user
        await user.save();
      }
  
      console.log("Weekly cleanup task completed successfully.");
    } catch (error) {
      console.error("Weekly cleanup task error:", error);
    }
  });


  app.post("/add-face", upload.single("file"), async (req, res) => {
    try {
      // Extract required fields from the request body.
      const { userId, cameraId, faceName } = req.body;
      if (!userId || !cameraId || !faceName) {
        return res.status(400).json({ error: "User ID, cameraId, and faceName are required" });
      }
  
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
  
      // Look up the camera object (with cameraName) in the user's cameras array.
      const cameraObj = user.cameras.find((cam) => cam.cameraId === cameraId);
      if (!cameraObj) {
        return res.status(403).json({ error: "Unauthorized camera" }); // Even for faces, we are keeping camera authorization as requested
      }
  
  
      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
      });
  
      // Refresh token if expired
      if (new Date() > user.expiresAt) {
        const { credentials } = await oauth2Client.refreshAccessToken();
        user.accessToken = credentials.access_token;
        // Update expiration (assuming 3600 seconds validity)
        user.expiresAt = new Date(Date.now() + 3600 * 1000);
        await user.save();
      }
  
      oauth2Client.setCredentials({ access_token: user.accessToken });
      const drive = google.drive({ version: "v3", auth: oauth2Client });
  
      // Helper function to get or create a folder by name (optionally within a parent folder)
      async function getOrCreateFolder(folderName, parentId) {
        let q = "name = '" + folderName + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        if (parentId) {
          q += " and '" + parentId + "' in parents";
        }
        const folderList = await drive.files.list({
          q,
          fields: "files(id, name)",
        });
        if (folderList.data.files && folderList.data.files.length > 0) {
          return folderList.data.files[0].id;
        } else {
          const fileMetadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
          };
          if (parentId) {
            fileMetadata.parents = [parentId];
          }
          const folder = await drive.files.create({
            requestBody: fileMetadata,
            fields: "id",
          });
          return folder.data.id;
        }
      }
  
      // Get or create "HomeSecurity" folder.
      const homeFolderId = await getOrCreateFolder("HomeSecurity");
  
      // Get or create "faces" folder inside "HomeSecurity"
      const facesFolderId = await getOrCreateFolder("faces", homeFolderId);
  
      // Upload file into the "faces" folder.
      const fileMetadata = {
        name: req.file.originalname, // You might want to rename it for better organization
        parents: [facesFolderId],
      };
      const media = {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path),
      };
  
      const driveResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id",
      });
  
      fs.unlinkSync(req.file.path); // Cleanup temporary file
  
      // Add the face to the user's faces array in the database
      user.faces.push({ faceName: faceName, fileId: driveResponse.data.id });
      await user.save();
  
      // Build the response object
      const responseData = {
        faceName: faceName,
        fileId: driveResponse.data.id,
        message: "Face added successfully",
      };

      console.log(`Face added: ${faceName}, fileId: ${driveResponse.data.id}`);
  
      // Send the response back to the client.
      res.json(responseData);
    } catch (error) {
      console.error("Add face error:", error);
      res.status(500).json({ error: "Failed to add face" });
    }
  });

  app.post("/undo-retain-file", async (req, res) => {
    try {
      const { userId, fileId } = req.body;
      if (!userId || !fileId) {
        return res.status(400).json({ error: "userId and fileId are required" });
      }
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      let fileFound = false;
      // Iterate through each upload entry to find the matching file.
      user.uploads.forEach((uploadEntry) => {
        uploadEntry.files.forEach((file) => {
          if (file.fileId === fileId) {
            file.retain = false; // Undo retention
            fileFound = true;
          }
        });
      });
  
      if (!fileFound) {
        return res.status(404).json({ error: "File not found in user uploads" });
      }
  
      await user.save();
      res.json({ message: "File retention undone successfully" });
    } catch (error) {
      console.error("Undo retain file error:", error);
      res.status(500).json({ error: "Failed to undo retain file" });
    }
  });
  



// Example: POST /retain-file
// Body: { userId, fileId }
app.post("/retain-file", async (req, res) => {
    try {
      const { userId, fileId } = req.body;
      if (!userId || !fileId) {
        return res.status(400).json({ error: "userId and fileId are required" });
      }
  
      const user = await User.findOne({ googleId: userId });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
  
      // Find the file in user.uploads and set retain = true
      let fileFound = false;
      user.uploads.forEach((uploadEntry) => {
        uploadEntry.files.forEach((file) => {
          if (file.fileId === fileId) {
            file.retain = true;
            fileFound = true;
          }
        });
      });
  
      if (!fileFound) {
        return res.status(404).json({ error: "File not found in user uploads" });
      }
  
      await user.save();
      res.json({ message: "File retained successfully" });
    } catch (error) {
      console.error("Retain file error:", error);
      res.status(500).json({ error: "Failed to retain file" });
    }
  });

  
const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

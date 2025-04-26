const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  time: { type: Date, default: Date.now },
  cameraId: { type: String, required: true },
  event: { type: String, required: true },
  retain: { type: Boolean, default: false } // Field for retention
});

const uploadEntrySchema = new mongoose.Schema({
  date: { type: String, required: true },
  files: { type: [fileSchema], default: [] }
});

const faceSchema = new mongoose.Schema({
  faceName: { type: String, required: true },
  fileId: { type: String, required: true }
});

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true },
  accessToken: String,
  refreshToken: String,
  expiresAt: Date,
  // Now cameras is an array of objects with both cameraId and cameraName.
  cameras: {
    type: [
      {
        cameraId: { type: String, required: true },
        cameraName: { type: String, required: true }
      }
    ],
    default: []
  },
  uploads: { type: [uploadEntrySchema], default: [] },
  faces: { type: [faceSchema], default: [] } // New field for faces
});

module.exports = mongoose.model("User", userSchema);



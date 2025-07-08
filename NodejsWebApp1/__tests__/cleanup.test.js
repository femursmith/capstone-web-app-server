const mongoose = require('mongoose');
const { google } = require('googleapis');
const cron = require('node-cron');

// Mock the User model
jest.mock('../models/User');
const User = require('../models/User');

// Import the module under test; assume server.js exports the cleanup function
const { weeklyCleanupTask } = require('../server');

// Helper to create a user-like object
function makeUser(doc) {
  return {
    uploads: JSON.parse(JSON.stringify(doc.uploads)),
    save: jest.fn().mockResolvedValue(),
    ...doc,
  };
}

describe('Weekly cleanup scheduled deletion', () => {
  let deleteSpy;
  let mockDrive;

  beforeAll(() => {
    // Mock google.drive
    mockDrive = {
      files: { delete: jest.fn().mockResolvedValue() },
    };
    google.drive = jest.fn().mockReturnValue(mockDrive);

    deleteSpy = mockDrive.files.delete;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should delete non-retained files and remove empty upload entries', async () => {
    // Prepare two users
    const fileA = { fileId: 'A', retain: false };
    const fileB = { fileId: 'B', retain: true };
    const fileC = { fileId: 'C', retain: false };

    const user1 = makeUser({
      googleId: 'user1',
      accessToken: 'token1',
      refreshToken: 'refresh1',
      expiresAt: new Date(Date.now() + 1000 * 60),
      uploads: [
        { date: '2025-05-01', files: [fileA, fileB] }
      ],
    });
    const user2 = makeUser({
      googleId: 'user2',
      accessToken: 'token2',
      refreshToken: 'refresh2',
      expiresAt: new Date(Date.now() + 1000 * 60),
      uploads: [
        { date: '2025-04-01', files: [fileC] }
      ],
    });

    // Mock User.find
    User.find.mockResolvedValue([user1, user2]);

    // Invoke the cleanup task
    await weeklyCleanupTask();

    // Drive delete called for A and C
    expect(deleteSpy).toHaveBeenCalledWith({ fileId: 'A' });
    expect(deleteSpy).toHaveBeenCalledWith({ fileId: 'C' });
    expect(deleteSpy).toHaveBeenCalledTimes(2);

    // After cleanup, user1.uploads should still have entry for date '2025-05-01' with only fileB
    expect(user1.uploads).toEqual([{ date: '2025-05-01', files: [fileB] }]);

    // user2.uploads should be empty and therefore removed
    expect(user2.uploads).toEqual([]);

    // Ensure save was called on each user
    expect(user1.save).toHaveBeenCalled();
    expect(user2.save).toHaveBeenCalled();
  });
});

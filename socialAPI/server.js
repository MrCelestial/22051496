// Import required dependencies
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Constants
const TEST_SERVER_BASE_URL = 'http://20.244.56.144/evaluation-service';
const PORT = process.env.PORT || 3000;
const AUTH_FILE_PATH = path.join(__dirname, 'auth_credentials.json');

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());

// Authentication credentials
let authCredentials = null;

// Cache for efficient retrieval
const cache = {
  users: null,
  userPostCounts: {},
  popularPosts: null,
  latestPosts: null,
  lastUpdated: null
};

// Cache invalidation time (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Initialize - Load or get new credentials
async function initializeAuth() {
  try {
    // Try to load existing credentials
    if (fs.existsSync(AUTH_FILE_PATH)) {
      const data = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
      authCredentials = JSON.parse(data);
      console.log('Loaded existing credentials');
    } else {
      await registerAndAuthenticate();
    }
  } catch (error) {
    console.error('Error during initialization:', error.message);
    throw new Error('Failed to initialize authentication');
  }
}

// Register and authenticate with the test server
async function registerAndAuthenticate() {
  try {
    // Step 1: Register with the test server
    const registrationData = {
      "email": "22051496@kiit.ac.in",
      "name": "Anubrato Basu",
      "mobileNo": "8420870124",
      "githubUsername": "MrCelestial",
      "rollNo": "22051496",
      "collegeName": "KIIT-DU",
      "accessCode": "nwpwrZ"
    };

    console.log('Sending registration request with data:', JSON.stringify(registrationData));
    
    const registrationResponse = await axios.post(
      `${TEST_SERVER_BASE_URL}/register`,
      registrationData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Registration successful:', registrationResponse.data);

    // Step 2: Authenticate and get token using response data
    const authData = {
      "email": registrationResponse.data.email,
      "name": registrationResponse.data.name,
      "rollNo": registrationResponse.data.rollNo,
      "accessCode": registrationResponse.data.accessCode,
      "clientID": registrationResponse.data.clientID,
      "clientSecret": registrationResponse.data.clientSecret
    };

    console.log('Sending auth request with data:', JSON.stringify(authData));
    
    const authResponse = await axios.post(
      `${TEST_SERVER_BASE_URL}/auth`,
      authData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Authentication successful, received token');

    // Save credentials
    authCredentials = {
      ...authData,
      token: authResponse.data.token,
      token_type: authResponse.data.token_type,
      expires_in: authResponse.data.expires_in
    };

    // Save to file
    fs.writeFileSync(AUTH_FILE_PATH, JSON.stringify(authCredentials, null, 2));
    console.log('New credentials obtained and saved');

  } catch (error) {
    console.error('Error during registration/authentication:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }
    throw new Error('Failed to register or authenticate');
  }
}

// Helper function to fetch all users from the test server
async function fetchUsers() {
  try {
    if (cache.users && cache.lastUpdated && (Date.now() - cache.lastUpdated < CACHE_TTL)) {
      return cache.users;
    }
    
    // Ensure we have valid credentials
    if (!authCredentials || !authCredentials.token) {
      await initializeAuth();
    }
    
    const response = await axios.get(`${TEST_SERVER_BASE_URL}/users`, {
      headers: {
        'Authorization': `Bearer ${authCredentials.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    cache.users = response.data.users;
    cache.lastUpdated = Date.now();
    return cache.users;
  } catch (error) {
    console.error('Error fetching users:', error.message);
    if (error.response && error.response.status === 401) {
      // Token might be expired, try to re-authenticate
      await initializeAuth();
      return fetchUsers(); // Retry the request
    }
    throw new Error('Failed to fetch users from the test server');
  }
}

// Helper function to fetch posts for a specific user
async function fetchUserPosts(userId) {
  try {
    // Ensure we have valid credentials
    if (!authCredentials || !authCredentials.token) {
      await initializeAuth();
    }
    
    const response = await axios.get(`${TEST_SERVER_BASE_URL}/users/${userId}/posts`, {
      headers: {
        'Authorization': `Bearer ${authCredentials.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.posts || [];
  } catch (error) {
    console.error(`Error fetching posts for user ${userId}:`, error.message);
    if (error.response && error.response.status === 401) {
      // Token might be expired, try to re-authenticate
      await initializeAuth();
      return fetchUserPosts(userId); // Retry the request
    }
    return [];
  }
}

// Helper function to fetch comments for a specific post
async function fetchPostComments(postId) {
  try {
    // Ensure we have valid credentials
    if (!authCredentials || !authCredentials.token) {
      await initializeAuth();
    }
    
    const response = await axios.get(`${TEST_SERVER_BASE_URL}/posts/${postId}/comments`, {
      headers: {
        'Authorization': `Bearer ${authCredentials.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data.comments || [];
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error.message);
    if (error.response && error.response.status === 401) {
      // Token might be expired, try to re-authenticate
      await initializeAuth();
      return fetchPostComments(postId); // Retry the request
    }
    return [];
  }
}

// Calculate and cache user post counts
async function calculateUserPostCounts() {
  try {
    const users = await fetchUsers();
    const userIds = Object.keys(users);
    
    for (const userId of userIds) {
      if (!cache.userPostCounts[userId] || (Date.now() - cache.lastUpdated > CACHE_TTL)) {
        const posts = await fetchUserPosts(userId);
        cache.userPostCounts[userId] = posts.length;
      }
    }
    
    return cache.userPostCounts;
  } catch (error) {
    console.error('Error calculating user post counts:', error.message);
    throw error;
  }
}

// Endpoint 1: Top Users - Get top 5 users with the highest number of posts
app.get('/users', async (req, res) => {
  try {
    const users = await fetchUsers();
    const postCounts = await calculateUserPostCounts();
    
    // Sort users by post count and get top 5
    const topUsers = Object.keys(postCounts)
      .sort((a, b) => postCounts[b] - postCounts[a])
      .slice(0, 5)
      .map(userId => ({
        id: userId,
        name: users[userId],
        postCount: postCounts[userId]
      }));
    
    res.json({ topUsers });
  } catch (error) {
    console.error('Error in /users endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to fetch all posts with comment counts
async function fetchPostsWithCommentCounts() {
  try {
    const users = await fetchUsers();
    const userIds = Object.keys(users);
    let allPosts = [];
    
    for (const userId of userIds) {
      const userPosts = await fetchUserPosts(userId);
      
      for (const post of userPosts) {
        const comments = await fetchPostComments(post.id);
        allPosts.push({
          id: post.id,
          userId,
          userName: users[userId],
          content: post.content,
          timestamp: post.timestamp,
          commentCount: comments.length
        });
      }
    }
    
    return allPosts;
  } catch (error) {
    console.error('Error fetching posts with comment counts:', error.message);
    throw error;
  }
}

// Endpoint 2: Top/Latest Posts
app.get('/posts', async (req, res) => {
  try {
    const type = req.query.type || 'latest';
    
    if ((type === 'popular' && cache.popularPosts && (Date.now() - cache.lastUpdated < CACHE_TTL)) ||
        (type === 'latest' && cache.latestPosts && (Date.now() - cache.lastUpdated < CACHE_TTL))) {
      return res.json({
        posts: type === 'popular' ? cache.popularPosts : cache.latestPosts
      });
    }
    
    const allPosts = await fetchPostsWithCommentCounts();
    
    if (type === 'popular') {
      // Sort by comment count (highest first)
      const popularPosts = allPosts
        .sort((a, b) => b.commentCount - a.commentCount)
        .filter(post => post.commentCount > 0);
      
      // Find posts with the maximum comment count
      const maxCommentCount = popularPosts.length > 0 ? popularPosts[0].commentCount : 0;
      const mostCommentedPosts = popularPosts.filter(post => post.commentCount === maxCommentCount);
      
      cache.popularPosts = mostCommentedPosts;
      res.json({ posts: mostCommentedPosts });
    } else if (type === 'latest') {
      // Sort by timestamp (newest first) and get the latest 5
      const latestPosts = allPosts
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 5);
      
      cache.latestPosts = latestPosts;
      res.json({ posts: latestPosts });
    } else {
      res.status(400).json({ error: 'Invalid type parameter. Use "popular" or "latest".' });
    }
    
    cache.lastUpdated = Date.now();
  } catch (error) {
    console.error('Error in /posts endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start the server with initialization
(async () => {
  try {
    await initializeAuth();
    app.listen(PORT, () => {
      console.log(`Social Media Analytics Microservice running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
})();

module.exports = app; // For testing purposes
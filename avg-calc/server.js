const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Configuration
const WINDOW_SIZE = 10;
const REQUEST_TIMEOUT = 500; // ms
const TEST_SERVER_URL = 'http://20.244.56.144';
const AUTH_FILE_PATH = path.join(__dirname, 'auth_token.json');

// API endpoint mapping
const API_ENDPOINTS = {
  'p': '/evaluation-service/primes',
  'f': '/evaluation-service/fibo',
  'e': '/evaluation-service/even',
  'r': '/evaluation-service/rand'
};

// Store for different types of numbers
const numberStore = {
  p: [], // prime numbers
  f: [], // fibonacci numbers
  e: [], // even numbers
  r: []  // random numbers
};

// Authentication credentials
let authCredentials = null;

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
      `${TEST_SERVER_URL}/evaluation-service/register`,
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
      `${TEST_SERVER_URL}/evaluation-service/auth`,
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

// Middleware for request validation
function validateNumberId(req, res, next) {
  const numberId = req.params.numberId;
  const validIds = ['p', 'f', 'e', 'r'];
  
  if (!validIds.includes(numberId)) {
    return res.status(400).json({ 
      error: 'Invalid number ID. Valid IDs are: p (prime), f (fibonacci), e (even), r (random)' 
    });
  }
  
  next();
}

// Fetch numbers from test server API based on number type
async function fetchNumbers(numberType) {
  try {
    // Ensure we have valid credentials
    if (!authCredentials || !authCredentials.token) {
      await initializeAuth();
    }

    const endpoint = API_ENDPOINTS[numberType];
    if (!endpoint) {
      throw new Error(`Unknown number type: ${numberType}`);
    }

    const response = await axios.get(
      `${TEST_SERVER_URL}${endpoint}`, 
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'Authorization': `Bearer ${authCredentials.token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Process the response according to the API format
    if (response.data && Array.isArray(response.data.numbers)) {
      return response.data.numbers;
    } else {
      console.error('Unexpected API response format:', response.data);
      return [];
    }
  } catch (error) {
    console.error(`Error fetching ${numberType} numbers:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data));
    }
    return [];
  }
}

// Add unique number to store, maintaining window size
function addUniqueNumber(store, number) {
  if (!store.includes(number)) {
    store.push(number);
    
    // If we exceed window size, remove oldest number
    if (store.length > WINDOW_SIZE) {
      store.shift();
    }
  }
  
  return [...store];
}

// Calculate average of numbers in the store
function calculateAverage(numbers) {
  if (numbers.length === 0) return 0;
  
  const sum = numbers.reduce((acc, num) => acc + num, 0);
  return parseFloat((sum / numbers.length).toFixed(2));
}

// Endpoint to handle number requests
app.get('/numbers/:numberId', validateNumberId, async (req, res) => {
  const numberId = req.params.numberId;
  const store = numberStore[numberId];
  
  // Store the previous state
  const windowPrevState = [...store];
  
  // Fetch new numbers from the test server API
  const fetchedNumbers = await fetchNumbers(numberId);
  
  // Process fetched numbers
  let currState = [...store];
  for (const num of fetchedNumbers) {
    currState = addUniqueNumber(store, num);
  }
  
  // Prepare response
  const response = {
    windowPrevState: windowPrevState,
    windowCurrState: store,
    numbers: fetchedNumbers,
    avg: calculateAverage(store)
  };
  
  res.json(response);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Service is running' });
});

// Start the server with initialization
(async () => {
  try {
    await initializeAuth();
    app.listen(port, () => {
      console.log(`Numbers API service listening on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
})();
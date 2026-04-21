// Import required modules
const express = require('express'); // Express is a minimal Node.js framework for building web applications.
const amqp = require('amqplib/callback_api'); // AMQP (Advanced Message Queuing Protocol) client library for RabbitMQ.
const cors = require('cors'); // CORS (Cross-Origin Resource Sharing) middleware for handling cross-origin requests.
require('dotenv').config(); // Load environment variables from .env file in development

const { MongoClient } = require("mongodb");
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || "bestbuy";
const client = new MongoClient(MONGO_URI);

let ordersCollection;

const app = express(); // Create an Express application instance.
app.use(express.json()); // Middleware to parse incoming JSON request bodies.

// Enable CORS (Cross-Origin Resource Sharing) for all routes
app.use(cors());

// Get the RabbitMQ URL and the port from environment variables
const RABBITMQ_CONNECTION_STRING = process.env.RABBITMQ_CONNECTION_STRING || 'amqp://localhost';  // Fallback to localhost if not defined
const PORT = process.env.PORT || 3000;  // Fallback to port 3000 if not defined

app.get('/orders', async (req, res) => {
  try {
    if (!ordersCollection) {
      return res.status(500).send('MongoDB not connected');
    }

    const orders = await ordersCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).send('Failed to fetch orders');
  }
});

// Define a POST route for creating orders
app.post('/orders', async (req, res) => {
  const order = {
    ...req.body,
    status: "pending",
    createdAt: new Date()
  };
   
  try {
   if (!ordersCollection) {
    return res.status(500).send('MongoDB not connected');
   }
  await ordersCollection.insertOne(order)
  console.log("Order saved to MongoDB");
  
  // Connect to RabbitMQ server
  amqp.connect(RABBITMQ_CONNECTION_STRING, (err, conn) => {
    if (err) {
      // If an error occurs while connecting to RabbitMQ, send a 500 status and error message.
      return res.status(500).send('Error connecting to RabbitMQ');
    }

    // Once connected to RabbitMQ, create a channel to communicate with it.
    conn.createChannel((err, channel) => {
      if (err) {
        // If an error occurs while creating a channel, send a 500 status and error message.
        return res.status(500).send('Error creating channel');
      }

      const queue = 'order_queue'; // Define the queue where the order will be sent.
      const msg = JSON.stringify(order); // Convert the order object to a JSON string.

      // Assert (create) the queue if it doesn't already exist.
      channel.assertQueue(queue, { durable: true });

      // Send the order message to the queue.
      channel.sendToQueue(queue, Buffer.from(msg));

      // Log the sent order to the console.
      console.log("Sent order to queue:", msg);

      // Send a response to the client confirming that the order was received.
      res.send('Order received');
    });
  });
    } catch (err) {
    console.error("Error saving order:", err);
    res.status(500).send('Failed to save order');
    }
});

async function connectToMongo() {
  try {
    await client.connect();

    const db = client.db(DB_NAME);
    ordersCollection = db.collection("orders");

    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

connectToMongo();

// Start the server using the port from environment variables
app.listen(PORT, () => {
  console.log(`Order service is running on http://localhost:${PORT}`);
});
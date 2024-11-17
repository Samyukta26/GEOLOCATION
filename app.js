import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import employeeRouter from './routes/employeeRouter.js';
import Attendance from './models/attendanceModel.js';
import Employee from './models/employeeModel.js';
import mongooseConnection from './config/mongooseConnection.js';

// Initialize Express
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ["GET", "POST"],
    credentials: true,
  }
});

// Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173"); // Allow frontend origin
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(cors({
  origin: 'http://localhost:5173', // Match the origin
  credentials: true, // Allow credentials to be sent
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const activeConnections = {}; // Object to track active connections by empId

io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on('registerEmpId', async (empId) => {
    if (activeConnections[empId]) {
      // Disconnect the previous socket associated with this empId
      console.log(`EmpId ${empId} already has an active connection. Disconnecting the previous socket.`);
      activeConnections[empId].disconnect(true);
    }

    // Register the new socket connection
    activeConnections[empId] = socket;
    console.log(`Mapped empId ${empId} to socket ID ${socket.id}`);
  });

  socket.on("sendLocation", async (data) => {
    const { latitude, longitude, inside, empId } = data;
    
    if (!empId) {
      console.log("empId is not defined.");
      return;
    }

    console.log("Received location data:", latitude, longitude, "for empId:", empId);

    const isInsideOffice = inside;
    console.log(isInsideOffice);

    let attendanceRecord = await Attendance.findOne( { employee: empId, date: new Date().setHours(0, 0, 0, 0) });
    console.log("Attendance record found:", attendanceRecord);

    if (isInsideOffice) {
      if (!attendanceRecord) {
        // No check-in recorded for today, log the check-in time
        attendanceRecord = new Attendance({
          employee: empId,
          date: new Date().setHours(0, 0, 0, 0),
          checkInTime: new Date(),
        });
        await attendanceRecord.save();
        console.log("Check-in recorded for employee:", empId);
      }
    } else {
      if (attendanceRecord && !attendanceRecord.checkOutTime) {
        // Log check-out time
        attendanceRecord.checkOutTime = new Date();
        await attendanceRecord.save();
        console.log("Check-out recorded for employee:", empId);
      }
    }

    io.emit("receiveLocation", { id: socket.id, ...data });
  }, []);

  socket.on("disconnect", async () => {
    console.log("User disconnected", socket.id);

    // Remove the socket from active connections
    for (const empId in activeConnections) {
      if (activeConnections[empId] === socket) {
        delete activeConnections[empId];
        console.log(`Removed empId ${empId} from active connections`);
        break;
      }
    }

    io.emit("userDisconnected", socket.id);
  });
});


app.post('/api/checkin', async (req, res) => {
  const { userId, timestamp, latitude, longitude } = req.body;

  if (!userId || !timestamp || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'User ID, timestamp, latitude, and longitude are required.' });
  }

  let today = new Date().setHours(0, 0, 0, 0); // Get today's date without time
  let attendanceRecord = await Attendance.findOne({ employee: userId, date: today });

  if (!attendanceRecord) {
    attendanceRecord = new Attendance({
      employee: userId,
      date: today,
      checkInTime: new Date(timestamp),
      checkInLocation: { latitude, longitude }
    });
    await attendanceRecord.save();
    return res.status(200).json({ message: 'Check-in successful.' });
  }

  return res.status(400).json({ message: 'Check-in already recorded for today.' });
});

// Check-Out Endpoint
app.post('/api/checkout', async (req, res) => {
  const { userId, timestamp, latitude, longitude } = req.body;

  if (!userId || !timestamp || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'User ID, timestamp, latitude, and longitude are required.' });
  }

  let today = new Date().setHours(0, 0, 0, 0); // Get today's date without time
  let attendanceRecord = await Attendance.findOne({ employee: userId, date: today });

  if (attendanceRecord && !attendanceRecord.checkOutTime) {
    attendanceRecord.checkOutTime = new Date(timestamp);
    attendanceRecord.checkOutLocation = { latitude, longitude };
    await attendanceRecord.save();
    return res.status(200).json({ message: 'Check-out successful.' });
  }

  return res.status(400).json({ message: 'Check-out not possible or already done for today.' });
});

app.get('/api/status/:id', async (req, res) => {
  const empId = req.params.id;

  try {
    const today = new Date().setHours(0, 0, 0, 0); // Get today's date without time
    const attendanceRecord = await Attendance.findOne({ employee: empId, date: today });

    if (attendanceRecord) {
      let status = 'Not Checked In';

      if (attendanceRecord.checkInTime && !attendanceRecord.checkOutTime) {
        status = 'Checked In';
      } else if (attendanceRecord.checkInTime && attendanceRecord.checkOutTime) {
        status = 'Checked Out';
      }

      return res.status(200).json({
        status: status,
        checkInTime: attendanceRecord.checkInTime,
        checkOutTime: attendanceRecord.checkOutTime,
      });
    } else {
      return res.status(200).json({
        status: 'Not Checked In',
        checkInTime: null,
        checkOutTime: null,
      });
    }
  } catch (error) {
    console.error('Error fetching status:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/', (req, res) => {
  res.status(200).json({ message: "Welcome to the RTA System" });
});

app.use('/employees', employeeRouter);

server.listen(3000, () => {
  console.log('Server is up and running on port 3000');
});

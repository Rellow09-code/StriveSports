// server/index.js

const express = require('express')
const mongoose = require('mongoose')
const puppeteer = require('puppeteer') //the thing for downloading snapshots of dashboards
const cors = require('cors')
require('dotenv').config({path:'.env'});
const UserModel = require('./models/sportsbooking')
const ReportModel = require('./models/reports')
const TempEventModel = require('./models/events')
const {Resend} = require('resend');
const axios = require('axios'); // Required for Clerk API calls
const nodemailer = require('nodemailer'); //for nodemailer
const { clerkClient } = require('@clerk/clerk-sdk-node');  // correct import

const fs = require('fs');
const path = require('path');
const {jsPDF} = require('jspdf');
require('jspdf-autotable'); //for table formatting.
const { Parser } = require('json2csv');  //for csv generation.




const {createClerkClient} = require('@clerk/clerk-sdk-node');
const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
});


const app = express()

app.use(express.json())
app.use(cors());

app.use('/csv-data', express.static(path.join(__dirname, 'data'))); 

{/*This implementation is to allow cors to work on the deployed site as well as any local host server*/}
const allowedOrigins = [
  'https://blue-plant-09eedf103.6.azurestaticapps.net' // production site
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl or Postman)
    if (!origin) return callback(null, true);

    // Allow localhost from any port
    if (origin.startsWith('http://localhost')) return callback(null, true);

    // Allow production origin
    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));


const ATLAS_URL=process.env.ATLAS_URL;
const VITE_CLERK_PUBLISHABLE_KEY=process.env.VITE_CLERK_PUBLISHABLE_KEY;
const resend =new Resend(process.env.RESEND_API_KEY);
const CLERK_SECRET_KEY=process.env.CLERK_SECRET_KEY;

//node mailer transporter


mongoose.connect(ATLAS_URL,{
    useNewUrlParser: true,
    useUnifiedTopology:true

})
.then(()=>console.log("Mongodb connected"))
.catch((err)=> console.error("Mongodb connection error",err));

//check is booking slot is available
app.post('/check-booking', async (req, res) => {
    const { sport, date, time } = req.body;
    try {
        // Check if the booking already exists
        const exists = await UserModel.findOne({ sport, date, time });
        if (exists) {
          return res.status(409).json({ message: 'Time slot already booked' });
        }
    
        // If not, return a success message
        res.status(200).json({ message: 'Time slot available' });
      } catch (error) {
        console.error("Error checking booking:", error);
        res.status(500).json({ message: 'Internal server error' });
      }
    
  });

// allows the resident to make a booking.
// URL to make posts https://localhost:3000/bookings  
app.post('/bookings',async (req,res)=>{
    try {
        const {sport,date,time,residentInfo} = req.body;
        const newBooking = new UserModel({
            sport,
            date,
            time,
            residentInfo
        });
        await newBooking.save();
        res.status(201).json({message:"Booking successful"})
    } catch (error) {
        console.error("Error saving booking",error);
        res.status(500).json({error: "Failed to save booking"})
    }
}); 

// allowing the admin to retrieve the bookings.
//URL to get bookings http://localhost:3000/bookings admin run get method
app.get('/bookings', async (req, res) => {
    try {
        const bookings = await UserModel.find();
        res.json(bookings);
    } catch (err) {
        console.error('Failed to fetch bookings',err);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});
//for testing server.
app.get('/', (req, res) => {
    res.send('Server is running!');
  });
  
//approved bookings fetch
app.get('/bookings/approved', async (req, res) => {
    try {
        const approvedBookings = await UserModel.find(
            { status: "approved" },
            { sport: 1, date: 1, time: 1, _id: 0 } // Only include these fields
        )
        
        res.json(approvedBookings);
    } catch (err) {
        console.error('Failed to fetch approved bookings', err);
        res.status(500).json({ error: "Failed to fetch calendar events" });
    }
});
//update the booking status (approved or reject)
//URL for approve or reject http:localhost:3000/bookings/:id 
app.post('/bookings/:id', async (req, res) => {
    const { status } = req.body;
    if (!['approved', 'rejected','pending'].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
    }
    try {
        const updated = await UserModel.findByIdAndUpdate( //changed booking var to updated
            req.params.id,
            { status },
            { new: true }
        );
        res.json({ message: `Booking ${status}`, booking:updated });
    } catch (error) {
        console.error("Error updating booking status", error);
        res.status(500).json({ error: "Failed to update booking" });
    }
});

// Delete a booking from admin dashboard
//URL for  http:localhost:3000/bookings/:id 
app.delete('/bookings/:id', async (req, res) => {
    try {
        await UserModel.findByIdAndDelete(req.params.id);
        res.json({ message: 'Booking deleted' });
    } catch (error) {
        console.error('Error deleting booking', error);
        res.status(500).json({ error: 'Failed to delete booking' });
    }
});

{/*code for the model for reports.
 allows the resident to make a report .
 URL to make posts https://localhost:3000/reports */} 
app.post('/reports',async (req,res)=>{

    try {
        const {facility,issue,residentInfo,message} = req.body;
        
        const newReport = new ReportModel({
            facility,
            issue,
            residentInfo,
            message   //added this for the column and facility implementation.
        });
        await newReport.save();
        res.status(201).json({message:"Report successful"})
    } catch (error) {
        console.error("Error saving report",error);
        res.status(500).json({error: "Failed to save report"})
    }
}); 

{/* allowing the admin to retrieve the bookings.
URL to get bookings http://localhost:3000/reports admin run get method*/}
app.get('/reports', async (req, res) => {
    try {
        const reports = await ReportModel.find();
        res.json(reports);
    } catch (err) {
        console.error('Failed to fetch reports',err);
        res.status(500).json({ error: "Failed to fetch reports" });
    }
});

{/*update the booking status (approved or reject)

URL for approve or reject http:localhost:3000/reports/:id */}
app.post('/reports/:id', async (req, res) => {
    const { status } = req.body;
    if (!['In progress', 'Done','Pending'].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
    }
    try {
        const updatedreports = await ReportModel.findByIdAndUpdate( 
            req.params.id,
            { status },
            { new: true }
        );
        res.json({ message: `Reporting ${status}`, booking:updatedreports });
    } catch (error) {
        console.error("Error updating report status", error);
        res.status(500).json({ error: "Failed to update report" });
    }
});

{/* Delete a booking from admin dashboard
  URL for  http:localhost:3000/reports/:id */}
app.delete('/reports/:id', async (req, res) => {
    try {
        await ReportModel.findByIdAndDelete(req.params.id);
        res.json({ message: 'Report deleted' });
    } catch (error) {
        console.error('Error deleting report', error);
        res.status(500).json({ error: 'Failed to delete report' });
    }
});


{/* Implementing the events functionality
  URL for  http:localhost:3000/emails */}
app.post('/events',async (req,res)=>{
    const {event,date,time_from,time_to,event_description} = req.body;
    console.log("POST /events called with:", req.body); // Add this line
    try {
        const newEvent = new TempEventModel({
            event,
            date,
            time_from,
            time_to,
            event_description
        });
        await newEvent.save();
        res.status(201).json({message:"Event successful"})
    } catch (error) {
        console.error("Error saving event",error);
        res.status(500).json({error: "Failed to save event"})
    }
});

{/* Retrieve the events*/}
app.get('/events', async (req, res) => {
    try {
        const events = await TempEventModel.find();
        res.json(events);
    } catch (err) {
        console.error('Failed to fetch events',err);
        res.status(500).json({ error: "Failed to fetch events" });
    }
});
  

app.post('/emails', async (req, res) => {
    const { subject, message, emails } = req.body;
  
    if (!emails || emails.length === 0) {
      return res.status(400).json({ error: 'No user emails provided' });
    }
  
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <body>
        <h2>StriveSports Community</h2>
        <p>${message}</p>
        <p>Thank you,<br>StriveSports Team</p>
      </body>
      </html>
    `;
  
    try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });
    
        for (const email of emails) {
          await transporter.sendMail({
            from: `"StriveSports Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject,
            html: htmlContent,
          });
        }
  
      //await resend.batch.send(messages);  // Correct batch call
  
      res.status(200).json({ message: `Emails sent to ${emails.length} users.`,
        emails: emails  });
    } catch (error) {
      console.error('Email sending failed:', error);
      res.status(500).json({
        error: 'Email sending failed',
        details: error.response?.data || error.message || 'Unknown error',
      });
    }
  });

//delete an event
app.delete('/events/:id', async (req, res) =>{
    try{
      const deletedEvent = await TempEventModel.findByIdAndDelete(req.params.id);
      if (!deletedEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }
        res.json({message: 'Event Deleted'});
    }catch (error){
        console.error('Error deleting event', error);
        res.status(500).json({ error: 'Failed to delete event'})
    }
  });

  app.get('/useremails', async (req, res) => {
    try {
      // Fetch all users (you can paginate if you have many)
      const result = await clerk.users.getUserList({ limit: 10 });

    console.log('Full Clerk user result:', result);

    const users = Array.isArray(result.data) ? result.data : result;
    
    // Check the structure of each user
    users.forEach((user, i) => {
      console.log(`User ${i + 1}:`, user);
    });

    const emails = users.flatMap(u =>
      Array.isArray(u.emailAddresses)
        ? u.emailAddresses.map(e => e.emailAddress)
        : []
    );

    res.json({ emails });
  } catch (err) {
    console.error('Clerk fetch failed:', err);
    res.status(500).json({ error: 'Failed to fetch Clerk users', details: err.message });
    }
  });

  //for getting users
  app.get('/users', async(req, res) => {

    try{
        const users= await clerk.users.getUserList();

        res.status(200).send(users);
    }
    catch (error) {
        res.status(500).send({ errorMessage: error.message });
    }
})


//csv file downloading and formating api
app.get('/api/download-csv/:type', async (req, res) => {
  const { type } = req.params;
  let data;
  let fields;

  try {
    if (type === 'maintenance') {
      data = await ReportModel.find().lean();
      fields = ['facility', 'issue', 'residentInfo', 'message', 'status'];
    } else if (type === 'booking') {
      data = await UserModel.find().lean();
      fields = ['sport', 'date', 'time', 'residentInfo', 'status'];
    } else {
      return res.status(400).send('Invalid dashboard type');
    }

    if (!data || data.length === 0) {
      return res.status(404).send('No data found to export');
    }

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_dashboard_data.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('CSV generation error:', error);
    res.status(500).send('Failed to generate CSV');
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT,() =>{
    console.log(`Server is listening on port ${PORT}`)
})

{/*
    the :id is the MongoDB document _id taht the post response returns ,this allows you to path on
    the specific id huli
    
    - to use these create a button for rejecting or approve and look at the path thing the status is a new 
    column that will be added to the database so when a resident sends a booking we just make their
    status to be pending.
    
    
    */}
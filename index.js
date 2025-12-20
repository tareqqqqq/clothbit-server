require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY) 
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
// app.use(
//   cors({
//     origin: [process.env.CLIENT_DOMAIN],
//     credentials: true,
//     optionSuccessStatus: 200,
//   })
// )

app.use(cors({
  origin: true,   
  credentials: true,
}))
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {


    const db=client.db('productDB')
    const productCollection=db.collection('products')
    const ordersCollection = db.collection('orders')
     const usersCollection = db.collection('users')
// role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })

      next()
    }
    const verifySELLER = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'manager')
        return res
          .status(403)
          .send({ message: 'Manager only Actions!', role: user?.role })

      next()
    }





app.get('/home-products', async (req, res) => {
  const result = await productCollection
    .find({ showOnHome: true })
    .sort({ createdAt: -1 }) 
    .limit(6)               
    .toArray()

  res.send(result)
})

// pagination 
app.get('/product-pagination', async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 9
  const skip = (page - 1) * limit

  const totalProducts = await productCollection.countDocuments()
  const products = await productCollection
    .find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray()

  res.send({
    products,
    totalPages: Math.ceil(totalProducts / limit),
    currentPage: page
  })
})


// 11.save a product data in db by manager
    app.post('/products',async (req,res)=>{
      const productData=req.body
      console.log(productData)
      const result= await productCollection.insertOne(productData)
      res.send(result)
    })

    
    // get all products from db
    app.get('/products/:id', async (req, res) => {
      const id = req.params.id
      const result = await productCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })
    // get all products from db
    app.get('/all-orders/:id', async (req, res) => {
      const id = req.params.id
      const result = await ordersCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })
    // Payment endpoints
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      console.log(paymentInfo)
       const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
              name: paymentInfo?.title,
                description: paymentInfo?.description,
                images:paymentInfo.images,
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.buyerEmail,
        mode: 'payment',
        metadata: {
          productId: paymentInfo?.productId,
          buyer: paymentInfo?.buyerEmail,
          address: paymentInfo?.address,
          phone:paymentInfo?.phone,
          notes:paymentInfo?.notes,
          name:paymentInfo?.buyerName,
          payment:paymentInfo?.payment
        },
        
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/product/${paymentInfo?.productId}`,
      })
      
      res.send({ url: session.url })
    })


    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
     
     
      const product = await productCollection.findOne({
        _id: new ObjectId(session.metadata.productId),
      })
      const order = await ordersCollection.findOne({
        transactionId: session.payment_intent,
      })

      if (session.status === 'complete' && product && !order) {
        // save order data in db
        const orderInfo = {
          productId: session.metadata.productId,
          transactionId: session.payment_intent,
          buyerEmail: session.metadata.buyer,
           name: session.metadata.name,
           phone: session.metadata.phone,
           address: session.metadata.address,
           payment: session.metadata.payment,
           notes: session.metadata.notes,
          status: 'pending',
          manager: product.manager,
          title: product.title,
          category: product.category,
          address:session.metadata.address,
          quantity: 1,
          price: session.amount_total / 100,
          image: product?.images,
          date:new Date()
        }
        
        const result = await ordersCollection.insertOne(orderInfo)
        // update plant quantity
        await productCollection.updateOne(
          {
            _id: new ObjectId(session.metadata.productId),
          },
          { $inc: { quantity: -1 } }
        )
        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        })
      }
      
      return res.send({
          transactionId: session.payment_intent,
          orderId: order._id,
        })
      
      
    })

     // get all orders for a buyer by email
    app.get('/my-orders/:email', async (req, res) => {
      const email = req.params.email

      const result = await ordersCollection.find({ buyerEmail: email }).toArray()
      res.send(result)
    })

     // get all orders for a manager by email
    app.get('/manage-orders/:email', async (req, res) => {
      const email = req.params.email

      const result = await ordersCollection
        .find({ 'manager.email': email })
        .toArray()
      res.send(result)
    })

    // get all products for a manager by email
    app.get('/my-product/:email', async (req, res) => {
      const email = req.params.email

      const result = await productCollection
        .find({ 'manager.email': email })
        .toArray()
      res.send(result)
    })

     // save or update a user in db
    app.post('/user', async (req, res) => {
      const userData = req.body
      userData.created_at= new Date().toISOString()
      userData.last_loggedIn= new Date().toISOString()

      const query={
        email:userData.email
      }
      const alreadyExists=await usersCollection.findOne(query)
        if(alreadyExists){
          const result= await usersCollection.updateOne(query,{$set:{
            last_loggedIn:new Date().toISOString(),
          }})
          return res.send(result)
        }
      const result=await usersCollection.insertOne(userData)
      res.send(result)
    })
    // get a user's role
    app.get('/user/role/:email',  async (req, res) => {
      const email=req.params.email
      const result = await usersCollection.findOne({ email })
      res.send({ role: result?.role })
    })

    // admin role
    app.get('/products',async (req,res)=>{
      const result= await productCollection.find().toArray()
      res.send(result)
    })
    app.get('/orders',async (req,res)=>{
      const result= await ordersCollection.find().toArray()
      res.send(result)
    })
    app.get('/users',async (req,res)=>{
      const result= await usersCollection.find().toArray()
      res.send(result)
    })

    // manager roles 
    app.delete('/product/:id', async (req, res) => {
  const id = req.params.id
  const result = await productCollection.deleteOne({
    _id: new ObjectId(id),
  })
  res.send(result)
})
app.get('/product/:id', async (req, res) => {
  const { id } = req.params

  const product = await productCollection.findOne({
    _id: new ObjectId(id),
  })

  if (!product) {
    return res.status(404).send({ message: 'Product not found' })
  }

  res.send(product)
})


app.put('/product/:id', async (req, res) => {
  const id = req.params.id
  const updatedProduct = req.body

  const result = await productCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        title: updatedProduct.title,
        description: updatedProduct.description,
        category: updatedProduct.category,
        price: updatedProduct.price,
        quantity: updatedProduct.quantity,
        moq: updatedProduct.moq,
        images: updatedProduct.images,
        video: updatedProduct.video,
        payment: updatedProduct.payment,
        showOnHome: updatedProduct.showOnHome,
        updatedAt: new Date(),
      },
    }
  )

  res.send(result)
})
app.get('/orders/pending', async (req, res) => {
  const orders = await ordersCollection.find({
    status: 'pending',
  }).toArray()

  res.send(orders)
})
app.patch('/orders/approve/:id', async (req, res) => {
  const id = req.params.id

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: 'approved',
        approvedAt: new Date(),
      },
    }
  )

  res.send(result)
})
app.patch('/orders/reject/:id', async (req, res) => {
  const id = req.params.id

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: 'rejected',
        rejectedAt: new Date(),
      },
    }
  )

  res.send(result)
})
app.get('/orders/approved', async (req, res) => {
  const orders = await ordersCollection.find({
    status: 'approved',
  }).toArray()

  res.send(orders)
})
app.patch('/orders/tracking/:id', async (req, res) => {
  const id = req.params.id
  const tracking = req.body

  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $push: {
        tracking: {
          ...tracking,
          trackingDate: new Date(),
        },
      },
    }
  )

  res.send(result)
})
// PATCH /orders/cancel/:id
app.patch('/orders/cancel/:id', async (req, res) => {
  const id = req.params.id

  
  const order = await ordersCollection.findOne({
    _id: new ObjectId(id)
  })

  if (!order) {
    return res.status(404).send({ message: 'Order not found' })
  }

  // 2️⃣ Status check (Assignment rule)
  if (order.status !== 'pending') {
    return res
      .status(400)
      .send({ message: 'Cannot cancel this order' })
  }

  // 3️⃣ Status update
  const result = await ordersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: { status: 'Cancelled' }
    }
  )

  res.send({
    success: true,
    modifiedCount: result.modifiedCount
  })
})
// GET /orders/:id
app.get('/orders/:id', async (req, res) => {
  const id = req.params.id

  const order = await ordersCollection.findOne({
    _id: new ObjectId(id)
  })

  if (!order) {
    return res.status(404).send({ message: 'Order not found' })
  }

  res.send(order)
})

// Update User Role
app.patch('/users/role/:id', async (req, res) => {
  try {
    const { role } = req.body
    const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) })

    if (!user) {
      return res.status(404).send({ message: 'User not found' })
    }

    user.role = role
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { role: role } }
    )

    res.send({ success: true, message: 'User role updated successfully' })
  } catch (err) {
    console.error(err)
    res.status(500).send({ message: 'Server Error' })
  }
})

// Suspend User
// Suspend User with Feedback
app.patch('/users/suspend/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { status, feedback } = req.body; // Frontend theke status ar feedback nichi

    if (!feedback) {
      return res.status(400).send({ message: 'Feedback is required for suspension' });
    }

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: { 
        status: status, // 'Suspended'
        suspendFeedback: feedback // Feedback save kora hoche
      }
    };

    const result = await usersCollection.updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send({ success: true, message: 'User suspended successfully with feedback' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Server Error' });
  }
});

// Update,delete,hompage show product info by admin
app.patch('/products/update/:id', async (req, res) => {
  try {
    const id = req.params.id
    const updatedData = req.body

    const result = await productCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          title: updatedData.title,
          description: updatedData.description,
          price: updatedData.price,
          category: updatedData.category,
          images: updatedData.images,
          video: updatedData.video,
          payment: updatedData.payment,
          moq: updatedData.moq,
        },
      }
    )
    app.delete('/products/:id', async (req, res) => {
  const result = await productCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  })
  res.send(result)
})


    res.send({ success: true, result })
  } catch (error) {
    console.error(error)
    res.status(500).send({ message: 'Failed to update product' })
  }
})

app.patch('/products/show-home/:id', async (req, res) => {
  const { showOnHome } = req.body

  const result = await productCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { showOnHome } }
  )

  res.send(result)
})




    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})

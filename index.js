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

// save a product data in db
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
        customer_email: paymentInfo?.buyerEmail?.email,
        mode: 'payment',
        metadata: {
          productId: paymentInfo?.productId,
          customer: paymentInfo?.buyerEmail.email,
          address: paymentInfo?.address,
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
          customer: session.metadata.customer,
          status: 'pending',
          manager: product.manager,
          title: product.title,
          category: product.category,
          address:session.metadata.address,
          quantity: 1,
          price: session.amount_total / 100,
          image: product?.images,
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

     // get all orders for a customer by email
    app.get('/my-orders/:email', async (req, res) => {
      const email = req.params.email

      const result = await ordersCollection.find({ customer: email }).toArray()
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

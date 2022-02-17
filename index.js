const { google } = require('googleapis');
exports.sendEmail = async(req,res)=>{
var body = req.body[0]
  var to = body.to[0];
  var arrayBody = to.replace('[','');
  arrayBody = arrayBody.replace(']','');
  arrayBody = arrayBody.split(',');
  var entryArray = []
  arrayBody.forEach(elm =>{
    if(elm.indexOf(']') >-1){
      elm = elm.replace(']','')
    }
    entryArray.push((JSON.parse(elm)).email)
  })
  
  const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
  );
  const auth = await oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN});
  var gmail = google.gmail({version : 'v1', auth : oAuth2Client})

  if(entryArray.length >24999){
    //split up into smaller tasks and time out for another task in a few minutes to avoid passing the Gmail quota limits
    // the base for this is splitting the total into batches of 5k and spreading them a few seconds apart to take advantage of Cloud Function's Serverless Characteristics
    //you can change the base 5k to any interval you want to try and that works best for you
  
    var project = process.env.PROJECT_ID; // Your GCP Project id
    var queue = process.env.TASK_QUEUE; // Name of your Queue
    var location = process.env.REGION; // The GCP region of your queue
    var url = process.env.CLOUD_FUNCTION_URL; //use the cloud function trigger URL for this cloud func
    var total = entryArray.length;
    var batches = Math.round((total/5000) + 1);
    const {CloudTasksClient} = require('@google-cloud/tasks');
    // Instantiates a client.
    const client = new CloudTasksClient();
    const parent = client.queuePath(project, location, queue);
     const cloudTask = {
      httpRequest: {
        httpMethod: 'POST',
        headers : {
          "content-type" : "application/json"
        },
        url,
      },
    };
    for(b=0;b<batches;b++){
      var start = (b * 5000);
      var end = ((start + 5000) - 1)
      if(start > entryArray.length -1){
        break
      }
      if(end > entryArray.length -1 ){
        end = entryArray.length -1
      }
      var chunk = entryArray.slice(start, end);
      var payload = JSON.stringify({
        'body' : [
          {
            to : [(chunk).toString()]
          }
        ]
      }) // The task HTTP request body
      var inSeconds = ((b*2) + 60)  // Delay in task execution
      cloudTask.httpRequest.body = Buffer.from(payload).toString('base64');
      cloudTask.scheduleTime = {
        seconds: inSeconds + Date.now() / 1000,
      };
      console.log('Sending task:');
    console.log(cloudTask);
    try{
      const request = {parent: parent, task: cloudTask};
      const [response] = await client.createTask(request);
      console.log(`Created task ${response.name}`);
    }
    catch(err){
      console.log(err)
    }
  }  
  }
  else{
     //begin email body construction. Feel free to change out the subject directly in the code or by sending a different "Subject" request body parameter from the source (Integromat, Zapier, Etc.)
     const subject = body.Subject;
     const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    
     //send to every email in the list  
    for(i=0;i<entryArray.length;i++){
      try{
        const messageParts = [
          'From: ' + process.env.FROM_EMAIL,
          'To: ' + entryArray[i],
          'Content-Type: text/html; charset=utf-8',
          'MIME-Version: 1.0',
          `Subject: ${utf8Subject}`,
          '',
          body.Body //this is assuming you're sending some html code as a string from your API (Integromat, Zapier Etc). If you want to just write the HTML code directly in here you can do so by wrapping the entire html code as a string
        ];
        const message = messageParts.join('\n');
      
        // The body needs to be base64url encoded.
        const encodedMessage = Buffer.from(message)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });
      console.log(response.data);
      }
      catch(err){
        console.log(err);
      }
    }
  }
  
  
  res.sendStatus(200)
}

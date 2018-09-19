let express = require('express');
let serveStatic = require('serve-static');

let app = express();
app.use(express.static('static'));

app.listen(3000);
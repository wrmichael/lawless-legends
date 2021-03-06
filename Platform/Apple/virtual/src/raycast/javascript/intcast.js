
var $ = function(id) { return document.getElementById(id); };
var dc = function(tag) { return document.createElement(tag); };

var map = [
  [1,4,3,4,2,3,2,4,3,2,4,3,4],
  [1,0,0,0,0,0,0,3,0,0,2,0,3],
  [1,0,0,0,0,0,0,1,0,0,3,0,2],
  [3,0,0,1,2,3,0,4,0,0,4,0,3],
  [1,0,0,0,0,4,0,0,0,0,0,0,4],
  [2,0,0,2,0,2,0,0,0,0,0,0,4],
  [1,0,0,3,0,0,0,3,0,0,3,0,1],
  [3,0,0,1,0,0,0,3,0,0,2,0,3],
  [1,0,0,2,0,3,0,2,0,0,4,0,3],
  [1,0,0,0,0,2,0,0,0,0,0,0,1],
  [3,0,0,0,0,1,0,0,0,0,0,0,3],
  [1,0,0,4,0,4,0,3,1,2,4,0,2],
  [4,0,0,0,0,0,0,0,0,0,0,0,3],
  [1,2,3,3,3,2,2,1,2,4,2,2,2]
];

var player = {
  x : 11.0,      // current x, y position
  y : 10.5,
  dir : 0,    // the direction that the player is turning, either -1 for left or 1 for right.
  angleNum : 0, // the current angle of rotation
  speed : 0,    // is the playing moving forward (speed = 1) or backwards (speed = -1).
  moveSpeed : 0.25,  // how far (in map units) does the player move each step/update
  rotSpeed : 22.5 * Math.PI / 180 // how much does the player rotate each step/update (in radians)
}

var options = 0;

var debugRay = 0; /* Debugging info printed about this ray num, or null for none */

var maxAngleNum = 16;

var mapWidth = 0;
var mapHeight = 0;

var miniMapScale = 8;

var screenWidth = 504;
var screenHeight = 512;

var stripWidth = 1;
var fov = 45 * Math.PI / 180;

var numRays = Math.ceil(screenWidth / stripWidth);
var fovHalf = fov / 2;

var viewDist = (screenWidth/2) / Math.tan((fov / 2));

var twoPI = Math.PI * 2;

var numTextures = 4;

// Tables
var precastData = [];
var tbl_log2_b_b = null;
var tbl_pow2_b_b = null;
var tbl_log2_w_w = null;
var tbl_pow2_w_w = null;

function init() {

  mapWidth = map[0].length;
  mapHeight = map.length;

  bindKeys();

  initScreen();
  initCast();

  drawMiniMap();

  gameCycle();
}

var screenStrips = [];

function initScreen() {

  var screen = $("screen");

  for (var i=0;i<screenWidth;i+=stripWidth) {
    var strip = dc("div");
    strip.style.position = "absolute";
    strip.style.left = i + "px";
    strip.style.width = stripWidth+"px";
    strip.style.height = "0px";
    strip.style.overflow = "hidden";

    strip.style.backgroundColor = "magenta";

    var img = new Image();
    img.src = "walls.png";
    img.style.position = "absolute";
    img.style.left = "0px";

    strip.appendChild(img);
    strip.img = img;  // assign the image to a property on the strip element so we have easy access to the image later

    screenStrips.push(strip);
    screen.appendChild(strip);
  }

}

function initCast() 
{
  var i;
  
  console.log("Initializing cast data.");
  precastData = [];
  for (var angleNum = 0; angleNum < maxAngleNum; angleNum++) 
  {
    var angleData = [];
    for (var x = 0; x < 63; x++)
      angleData.push(prepCast(angleNum, x));
    precastData.push(angleData);
  }
  
  // Tables for 8-bit log2 and pow2
  tbl_log2_b_b = [];
  tbl_pow2_b_b = [];
  function o2_log2_b_b(n) {
    assert(n >= 4 && n <= 255, "n out of range for log2_b_b");
    var ln = Math.log(n) / Math.log(2);
    assert(ln >= 2 && ln < 8, "ln out of range");
    return ubyte(Math.max(0,Math.min(127,Math.round((ln-2) * 128 / 6))));
  }
  function o2_exp2_b_w(n) {
    var ln = (n * 6 / 128) + 4;
    return uword(Math.pow(2, ln));
  }
  tbl_log2_b_b[0] = tbl_log2_b_b[1] = tbl_log2_b_b[2] = tbl_log2_b_b[3] = 0;
  for (i=4; i<256; i++)
    tbl_log2_b_b[i] = o2_log2_b_b(i);
  for (i=0; i<256; i++)
    tbl_pow2_b_b[i] = ubyte(o2_exp2_b_w(i) >> 8);
    
  // Tables for 16-bit log2 and pow2. These handle the mantissa only, and the
  // exponent is handled by bit shifting and counting.
  //
  tbl_log2_w_w = [];
  for (i=0; i<256; i++)
    tbl_log2_w_w[i] = ubyte(Math.log((i+256) / 256) / Math.log(2) * 256);
  tbl_pow2_w_w = [];
  for (i=0; i<256; i++)
    tbl_pow2_w_w[i] = ubyte((Math.pow(2, i / 255) - 1) * 255);

  console.log("Done.");
}

function prepCast(angleNum, x)
{
  // Using the view angle, compute the direction vector 
  var angle = angleNum * player.rotSpeed;
  var dirX = Math.cos(angle);
  var dirY = Math.sin(angle);
  
  if (x == 0)
    console.log("angleNum=" + angleNum + 
              ", dirX=" + wordToHex(uword((dirX*64) & 0xFFFF)) + 
              ", dirY=" + wordToHex(uword((dirY*64) & 0xFFFF)));
  
  // Compute the camera plane, which is perpendicular to the direction vector
  var planeX = -Math.sin(angle) * 0.5; 
  var planeY = Math.cos(angle) * 0.5; 
  
  // Calculate ray position and direction. 
  // Note that normalizing this vector results in fisheye, so don't do it!
  var cameraX = 2 * x / 63 - 1; // x-coordinate in camera space
  var rayDirX = dirX + planeX * cameraX;
  var rayDirY = dirY + planeY * cameraX;
 
  // Length of ray from one x or y-side to next x or y-side
  var deltaDistX = Math.sqrt(1 + (rayDirY * rayDirY) / (rayDirX * rayDirX));
  var deltaDistY = Math.sqrt(1 + (rayDirX * rayDirX) / (rayDirY * rayDirY));

  deltaDistX = Math.min(255, deltaDistX/4);
  deltaDistY = Math.min(255, deltaDistY/4);
  
  // Get as much accuracy as we can into 8 bits
  var bestDiff = 99999;
  var bestNumer;
  var bestDenom;
  for (var denom = 1; denom < 128; denom++) {
    var numer = Math.floor(deltaDistX * denom / deltaDistY);
    var diff = Math.abs((numer/denom) - (deltaDistX/deltaDistY));
    if (numer >= 0 && numer < 128 && diff <= bestDiff) {
      bestDiff = diff;
      bestNumer = numer;
      bestDenom = denom;
    }
  }
  
  // Rarely-needed fallback
  if (bestNumer === undefined) 
  {
    bestNumer = deltaDistX;
    bestDenom = deltaDistY;
    while (bestNumer < 64 && bestDenom < 64) {
      bestNumer *= 2;
      bestDenom *= 2;
    }
  }
  
  deltaDistX = ubyte(bestNumer);
  deltaDistY = ubyte(bestDenom);
  
  // The math produces numbers a bit bigger than 1; we need to scale them down evenly.
  // (see fisheye note above).
  //
  var scaleFactor = 1.116;
  
  rayDirX = (rayDirX / scaleFactor) * 128;
  rayDirY = (rayDirY / scaleFactor) * 128;

  rayDirX = ubyte(Math.round(rayDirX) & 0xFF);
  rayDirY = ubyte(Math.round(rayDirY) & 0xFF);
  
  // Encapsulate the pre-computed numbers
  return { rayDirX: rayDirX, rayDirY: rayDirY,
           deltaDistX: deltaDistX, deltaDistY: deltaDistY };
}

function printPrecast() {
  for (var i=0; i<maxAngleNum; i++) {
    console.log("precast_" + i + ":");
    for (var j=0; j<63; j++) {
      console.log("    .byte $" + byteToHex(precastData[i][j].rayDirX) + "," +
                            "$" + byteToHex(precastData[i][j].rayDirY) + "," +
                            "$" + byteToHex(precastData[i][j].deltaDistX) + "," +
                            "$" + byteToHex(precastData[i][j].deltaDistY));
    }
    console.log("    .res 4 ; to bring it up to 256 bytes per angle");
  }
}

function printTbl(arr) {
  var line = null;
  for (var i in arr) {
    if (line == null)
      line = "    .byte ";
    else
      line += ",";
    line += "$" + byteToHex(arr[i]);
    if ((i%16) == 15) {
      console.log(line);
      line = null;
    }
  }
  if (line != null)
    console.log(line);
}

// bind keyboard events to game functions (movement, etc)
function bindKeys() {

  document.onkeydown = function(e) {
    e = e || window.event;

    switch (e.keyCode) { // which key was pressed?

      case 38: // up, move player forward, ie. increase speed
        player.speed = 1;
        break;

      case 40: // down, move player backward, set negative speed
        player.speed = -1;
        break;

      case 37: // left, rotate player left
        player.dir = -1;
        break;

      case 39: // right, rotate player right
        player.dir = 1;
        break;
        
      case 49: // '1': toggle option 1
        options ^= 1;
        console.log("options: " + options);
        initCast();
        break;
        
      case 50: // '2': toggle option 2
        options ^= 2;
        console.log("options: " + options);
        initCast();
        break;
        
      case 51: // '4': toggle option 3
        options ^= 4;
        console.log("options: " + options);
        initCast();
        break;
    }
  }

  document.onkeyup = function(e) {
    e = e || window.event;

    switch (e.keyCode) {
      case 38:
      case 40:
        player.speed = 0;   // stop the player movement when up/down key is released
        break;
      case 37:
      case 39:
        player.dir = 0;
        break;
    }
  }
}

function gameCycle() {

  move();

  updateMiniMap();

  castRays();

  setTimeout(gameCycle,1000/30); // aim for 30 FPS
  
  player.speed = 0;
  player.dir = 0;
}

function playerAngle()
{
  return player.angleNum * player.rotSpeed;
}

var prevX = -1;
var prevY = -1;
var prevAngleNum = -1;
var prevOptions = -1;

function castRays(force) 
{
  // If we're already showing this location and angle, no need to re-do it.
  if (!force && 
      player.x == prevX && 
      player.y == prevY && 
      player.angleNum == prevAngleNum &&
      options == prevOptions)
    return;
    
  console.log("Cast: x=" + player.x + ", y=" + player.y + ", angle=" + player.angleNum);

  // Cast all the rays and record the data
  lineData = [];
  var rayNum;
  for (rayNum = 0; rayNum < 63; rayNum++) {
    data = intCast(rayNum);
    // For display on the PC, expand pixels 8x
    data.height *= 8;
    for (var i=0; i<8; i++)
      lineData.push(data);
  }
  
  // Save position and angle (so we can avoid re-rendering if they don't change)
  prevX = player.x;
  prevY = player.y;
  prevAngleNum = player.angleNum;
  prevOptions = options;
  
  // Draw all the rays
  for (rayNum in lineData)
    drawStrip(rayNum, lineData[rayNum]);
}

function assert(flg, msg) {
  if (!flg) {
    console.log("Assertion failed: " + msg);
    throw msg;
  }
}

function byteToHex(d) {
  assert(d >= 0 && d <= 255, "byte out of range");
  var hex = Number(d).toString(16).toUpperCase();
  return "00".substr(0, 2 - hex.length) + hex; 
}

function wordToHex(d) {
  assert(d >= 0 && d <= 65535, "word out of range");
  var hex = Number(d).toString(16).toUpperCase();
  return "0000".substr(0, 4 - hex.length) + hex; 
}

// Convert a float to an unsigned byte by truncation
function ubyte(n) {
  assert(n >=0 && n < 256, "ubyte out of range");
  return parseInt(n);
}

// Convert a float to an signed byte by truncation
function sbyte(n) {
  assert(n >= -128 && n < 128, "sbyte out of range");
  return parseInt(n);
}

// Convert a float to an unsigned word by truncation
function uword(n) {
  assert(n >=0 && n < 65536, "ubyte out of range");
  return parseInt(n);
}

// Convert a float to an signed word by truncation
function sword(n) {
  assert(n >= -32768 && n < 32768, "sbyte out of range");
  return parseInt(n);
}

// Floor a 8.8 fixed number to an 8 bit int
function floor_w_b(num) {
  var ret = num >> 8;
  if (ret < 0 && (num&0xFF))
    --ret;
  return ret;
}

// Add two bytes, throwing away any overflow.
function uadd_bb_b(n1, n2) {
  assert(n1 >= 0 && n2 >= 0, "numbers for uadd_bb_b must be positive");
  assert(n1 <= 255 && n2 <= 255, "numbers for uadd_bb_b must be valid bytes");
  return (n1 + n2) & 0xFF;
}

// See if n1 < n2, unsigned
function uless_bb(n1, n2) {
  assert(n1 >= 0 && n2 >= 0, "numbers for uless_bb must be positive");
  assert(n1 <= 255 && n2 <= 255, "numbers for uless_bb must be valid bytes");
  return n1 < n2;
}

function log2(n, bits) {
  if (n < 1)
    return 0;
  var ln = Math.log(n) / Math.log(2);
  return Math.round(ln * (1<<bits));
}

function pow2(n, bits) {
  return Math.pow(2, n / (1<<bits));
}

// Fast log2: take ubyte and produce ubyte 3.5 fixed-point: base-2 logarithm
function log2_b_b(n) {
  return tbl_log2_b_b[n];
}

// Fast pow2: take ubyte 5.3 fixed-point logarithm, produce ubyte: 2^n
function pow2_b_b(n) {
  return tbl_pow2_b_b[n];
}

// Multiply two unsigned bytes, and take the high byte of the result.
function umul_bb_b(n1, n2) 
{
  assert(n1 >= 0 && n2 >= 0, "numbers for umul_bb_b must be positive");
  assert(n1 <= 255 && n2 <= 255, "numbers for umul_bb_b must be valid bytes");
  
  // Use table-based pow(log) for super-speed.
  if (n1 < 4 || n2 < 4) // fast and easy to compute; makes tables smaller
    return ubyte((n1*n2) >> 8);
  return pow2_b_b(log2_b_b(n1) + log2_b_b(n2));
  
  // non-log code for reference:
  //return ubyte((n1*n2) >> 8);
}

// Multiply two unsigned 8.8 numbers, resulting in 8.8
function umul_ww_w(n1, n2) {
  assert(n1 >= 0 && n2 >= 0, "numbers for umul_ww_w must be positive");
  assert(n1 <= 65535 && n2 <= 65535, "numbers for umul_ww_w must be valid words");
  return uword((n1*n2) >> 8);
}

// Unsigned mult, 16 by 8 bit, taking only lower 8 bits of result.
function umul_wb_b(n1, n2) {
  assert(n1 >= 0 && n1 <= 65535, "n1 for umul_wb_b must be valid unsigned word");
  assert(n2 >= 0 && n2 <= 255, "n2 for umul_wb_b must be valid unsigned byte");
  return ubyte(((n1*n2) >> 8) & 0xFF);
}

function abs_w_w(n) {
  return uword((n<0) ? -n : n);
}

// Table-based high precision log2 - 16 bit to 16 bit
function log2_w_w(n) {
  if (n == 0)
    return 0;
    
  // Calculate the exponent, and leave mantissa in n.
  var exp = 8;
  while (n >= 512) {
    exp++;
    n >>= 1;
  }
  while (n < 256) {
    exp--;
    n <<= 1;
  }
  
  // Combine to form the result
  return (exp << 8) | tbl_log2_w_w[n & 0xFF];
}

// Table-based high precision pow2 - 16 bit to 16 bit
function pow2_w_w(n) 
{
  var exp = n >> 8;
  var result = tbl_pow2_w_w[n & 0xFF] + 256;
  if (exp > 8)
    result <<= (exp-8);
  else if (exp < 8)
    result >>= (8-exp);
  return result;
}

function wallCalc(x, dist, bDir1, bDir2, bStep2)
{
  // Calculate perpendicular distance. Use logarithms for super-speed.
  dist = abs_w_w(dist);
  var diff = log2_w_w(dist) - log2_w_w(bDir1);
  
  // Calculate texture coordinate
  var sum = diff + log2_w_w(bDir2);
  bWallX = pow2_w_w(sum) & 0xFF;
  if (bStep2 < 0)
    bWallX ^= 0xFF;
  
  // Calculate line height
  lineHeight = uword(pow2_w_w(log2_w_w(64) - diff));
  if (x == debugRay) {
    console.log("    absDist=$" + wordToHex(dist) +
                  ", diff=$" + wordToHex(diff) +
                  ", sum=$" + wordToHex(sum));
                  
  }
  return [lineHeight, bWallX]
  
  /* No-log algorithm
  var wInvDir = uword(65536 / bDir1);
  var dist2 = umul_ww_w(dist, wInvDir);
  var bWallX = umul_wb_b(dist2, bDir2);
  if (bStep2 < 0)
    bWallX = 255 - bWallX;
  var lineHeight = Math.floor(63 * 256 / dist2);
  return [lineHeight, bWallX]
  */
}

// Let's try this with strictly integers. This should be the final
// step before the Apple II code.
//
function intCast(x)
{
  var data = precastData[player.angleNum][x];
  
  // Calculate ray position and direction 
  var wRayPosX = sword(player.x * 256);
  var wRayPosY = sword(player.y * 256);
  var bStepX   = 1;
  var bStepY   = 1;
  var bRayDirX = data.rayDirX;
  var bRayDirY = data.rayDirY;
  
  if (bRayDirX & 0x80) {
    bStepX = -1;
    bRayDirX ^= 0xFF;
  }

  if (bRayDirY & 0x80) {
    bStepY = -1;
    bRayDirY ^= 0xFF;
  }
  
  bRayDirX <<= 1;
  bRayDirY <<= 1;
  
  // Which box of the map we're in  
  var bMapX = floor_w_b(wRayPosX);
  var bMapY = floor_w_b(wRayPosY);
   
  // Length of ray from current position to next x or y-side
  var bSideDistX;
  var bSideDistY;
   
   // Length of ray from one x or y-side to next x or y-side
  var bDeltaDistX = data.deltaDistX;
  var bDeltaDistY = data.deltaDistY;
  
  if (x == debugRay) {
    console.log("intCast: ray=" + x + 
                ", bStepX=" + bStepX +
                ", bStepY=" + bStepY +
                ", bDeltaDistX=$" + byteToHex(bDeltaDistX) +
                ", bDeltaDistY=$" + byteToHex(bDeltaDistY));
  }

  // Calculate step and initial sideDist
  bSideDistX = wRayPosX & 0xFF;
  if (bStepX >= 0)
    bSideDistX ^= 0xFF;
  bSideDistX = umul_bb_b(bSideDistX, bDeltaDistX);

  bSideDistY = wRayPosY & 0xFF;
  if (bStepY >= 0)
    bSideDistY ^= 0xFF;
  bSideDistY = umul_bb_b(bSideDistY, bDeltaDistY);
  
  if (x == debugRay) {
    console.log("    initial sideDistX=$" + byteToHex(bSideDistX) + 
                          ", sideDistY=$" + byteToHex(bSideDistY));
  }
  
  // Distance to wall, and texture coordinate on the wall
  var lineHeight;
  var bWallX;
  
  // Perform DDA
  while (true)
  {
    // Jump to next map square in x-direction, OR in y-direction
    if (uless_bb(bSideDistX, bSideDistY)) {
      bMapX += bStepX;
      if (x == debugRay) {
        console.log("    sideX, mapX=" + bMapX + ", mapY=" + bMapY + 
                    ", bSideDistX=$" + byteToHex(bSideDistX) + 
                    ", bSideDistY=$" + byteToHex(bSideDistY));
      }
      bSideDistY -= bSideDistX;
      bSideDistX = bDeltaDistX
      if (map[bMapY][bMapX] > 0) { 
        if (x == debugRay)
          console.log("        hit X side");
        var wPerpWallDist = (bMapX<<8) - wRayPosX;
        if (bStepX < 0)
          wPerpWallDist += 256;
        nums = wallCalc(x, wPerpWallDist, bRayDirX, bRayDirY, bStepY);
        lineHeight = nums[0]
        bWallX = nums[1]
        bWallX = uadd_bb_b(bWallX, wRayPosY & 0xFF);
        if (bStepX >= 0)
          bWallX ^= 0xFF;
        break;
      }
    }
    else {
      bMapY += bStepY;
      if (x == debugRay) {
        console.log("    sideY, mapX=" + bMapX + ", mapY=" + bMapY + 
                    ", bSideDistX=$" + byteToHex(bSideDistX) + 
                    ", bSideDistY=$" + byteToHex(bSideDistY));
      }
      bSideDistX -= bSideDistY;
      bSideDistY = bDeltaDistY;
      if (map[bMapY][bMapX] > 0) { 
        if (x == debugRay)
          console.log("        hit Y side");
        var wPerpWallDist = (bMapY<<8) - wRayPosY;
        if (bStepY < 0)
          wPerpWallDist += 256;
        nums = wallCalc(x, wPerpWallDist, bRayDirY, bRayDirX, bStepX);
        lineHeight = nums[0];
        bWallX = nums[1];
        bWallX = uadd_bb_b(bWallX, wRayPosX & 0xFF);
        if (bStepY < 0)
          bWallX ^= 0xFF;
        break;
      }
    }
  }

  if (x == debugRay) {
    console.log("lineHeight=$" + wordToHex(lineHeight) +
                ", wallType=" + map[bMapY][bMapX] +
                ", wallX=$" + byteToHex(bWallX));
  }

  // Wrap it all in a nice package.
  return { wallType: map[bMapY][bMapX], 
           textureX: bWallX / 256.0,
           height:   lineHeight };
}

function newCast(x)
{
  var data = precastData[player.angleNum][x];
    
  // Calculate ray position and direction 
  var rayPosX = player.x;
  var rayPosY = player.y;
  var rayDirX = data.rayDirX;
  var rayDirY = data.rayDirY;
  
  // Which box of the map we're in  
  var mapX = Math.floor(rayPosX);
  var mapY = Math.floor(rayPosY);
   
  // Length of ray from current position to next x or y-side
  var sideDistX;
  var sideDistY;
   
   // Length of ray from one x or y-side to next x or y-side
  var deltaDistX = data.deltaDistX;
  var deltaDistY = data.deltaDistY;
   
  if (x == debugRay) {
    console.log("newCast: ray=" + x + 
                ", deltaDistX=" + deltaDistX.toString() +
                ", deltaDistY=" + deltaDistY.toString());
  }

  // What direction to step in x or y-direction (either +1 or -1)
  var stepX;
  var stepY;

  // Calculate step and initial sideDist
  if (rayDirX < 0) {
    stepX = -1;
    sideDistX = (rayPosX % 1) * deltaDistX;
  }
  else {
    stepX = 1;
    sideDistX = (1.0 - (rayPosX % 1)) * deltaDistX;
  }

  if (rayDirY < 0) {
    stepY = -1;
    sideDistY = (rayPosY % 1) * deltaDistY;
  }
  else {
    stepY = 1;
    sideDistY = (1.0 - (rayPosY % 1)) * deltaDistY;
  }  

  // Distance to wall, and texture coordinate on the wall
  var perpWallDist = 0;
  var wallX;
  
  // Perform DDA
  while (mapX >= 0 && mapX < mapWidth && mapY >= 0 && mapY < mapHeight)
  {
    // Jump to next map square in x-direction, OR in y-direction
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      if (x == debugRay) {
        console.log("    side0, mapX=" + mapX + ", mapY=" + mapY + 
                    ", sideDistX=" + sideDistX.toString() + 
                    ", sideDistY=" + sideDistY.toString());
      }    
      if (map[mapY][mapX] > 0) { 
        if (x == debugRay)
          console.log("        hit side 0");
        perpWallDist = (mapX - rayPosX + (1 - stepX) / 2) / rayDirX;
        wallX = (rayPosY + perpWallDist * rayDirY) % 1;
        if (rayDirX > 0)
          wallX = 1 - wallX;
        break;
      }
    }
    else {
      sideDistY += deltaDistY;
      mapY += stepY;
      if (x == debugRay) {
        console.log("    side1, mapX=" + mapX + ", mapY=" + mapY + 
                    ", sideDistX=" + sideDistX.toString() + 
                    ", sideDistY=" + sideDistY.toString());
      }    
      if (map[mapY][mapX] > 0) { 
        if (x == debugRay)
          console.log("        hit side 1");
        perpWallDist = (mapY - rayPosY + (1 - stepY) / 2) / rayDirY;
        wallX = (rayPosX + perpWallDist * rayDirX) % 1;
        if (rayDirY < 0) 
          wallX = 1 - wallX;
        break;
      }
    }
  }
  
  perpWallDist = Math.abs(perpWallDist);
     
  if (perpWallDist == 0)
    return { wallType:0, textureX:0, height:0 };
  
  // Calculate height of line to draw on screen
  var lineHeight = Math.abs(Math.floor(screenHeight / perpWallDist));

  if (x == debugRay) {
    console.debug("        perpWallDist=" + perpWallDist.toString() +
                  ", lineHeight=" + lineHeight.toString());
  }

  // Wrap it all in a nice package.
  return { wallType:map[mapY][mapX], textureX:wallX, height:lineHeight };
}

function drawStrip(stripIdx, lineData)
{
  var strip = screenStrips[stripIdx];
  
  // width is the same, but we have to stretch the texture to a factor of stripWidth to make it fill the strip correctly
  var width = lineData.height * stripWidth;

  // top placement is easy since everything is centered on the x-axis, so we simply move
  // it half way down the screen and then half the wall height back up.
  var top = Math.round((screenHeight - lineData.height) / 2);

  strip.style.height = lineData.height+"px";
  strip.style.top = top+"px";

  strip.img.style.height = Math.floor(lineData.height * numTextures) + "px";
  strip.img.style.width = Math.floor(width*2) +"px";
  strip.img.style.top = -Math.floor(lineData.height * (lineData.wallType-1)) + "px";
  
  var texX = Math.round(lineData.textureX*width);

  if (texX > width - stripWidth)
    texX = width - stripWidth;

  strip.img.style.left = -texX + "px";
}

function move() {
  var moveStep = player.speed * player.moveSpeed; // player will move this far along the current direction vector

  // add rotation if player is rotating (player.dir != 0)
  player.angleNum = player.angleNum + player.dir;
  if (player.angleNum < 0)
    player.angleNum += maxAngleNum;
  else if (player.angleNum >= maxAngleNum)
    player.angleNum -= maxAngleNum;

  var newX = player.x + Math.cos(playerAngle()) * moveStep;  // calculate new player position with simple trigonometry
  var newY = player.y + Math.sin(playerAngle()) * moveStep;

  if (isBlocking(newX, newY)) {   // are we allowed to move to the new position?
    return; // no, bail out.
  }

  player.x = newX; // set new position
  player.y = newY;
}

function isBlocking(x,y) {

  // first make sure that we cannot move outside the boundaries of the level
  if (y < 0 || y >= mapHeight || x < 0 || x >= mapWidth)
    return true;

  // return true if the map block is not 0, ie. if there is a blocking wall.
  return (map[Math.floor(y)][Math.floor(x)] != 0); 
}

function updateMiniMap() {

  var miniMap = $("minimap");
  var miniMapObjects = $("minimapobjects");

  var objectCtx = miniMapObjects.getContext("2d");
  miniMapObjects.width = miniMapObjects.width;

  objectCtx.fillStyle = "red";
  objectCtx.fillRect(   // draw a dot at the current player position
    player.x * miniMapScale - 2, 
    player.y * miniMapScale - 2,
    4, 4
  );

  objectCtx.strokeStyle = "red";
  objectCtx.beginPath();
  objectCtx.moveTo(player.x * miniMapScale, player.y * miniMapScale);
  objectCtx.lineTo(
    (player.x + Math.cos(playerAngle()) * 4) * miniMapScale,
    (player.y + Math.sin(playerAngle()) * 4) * miniMapScale
  );
  objectCtx.closePath();
  objectCtx.stroke();
}

function drawMiniMap() {

  // draw the topdown view minimap

  var miniMap = $("minimap");     // the actual map
  var miniMapCtr = $("minimapcontainer");   // the container div element
  var miniMapObjects = $("minimapobjects");   // the canvas used for drawing the objects on the map (player character, etc)

  miniMap.width = mapWidth * miniMapScale;  // resize the internal canvas dimensions 
  miniMap.height = mapHeight * miniMapScale;  // of both the map canvas and the object canvas
  miniMapObjects.width = miniMap.width;
  miniMapObjects.height = miniMap.height;

  var w = (mapWidth * miniMapScale) + "px"  // minimap CSS dimensions
  var h = (mapHeight * miniMapScale) + "px"
  miniMap.style.width = miniMapObjects.style.width = miniMapCtr.style.width = w;
  miniMap.style.height = miniMapObjects.style.height = miniMapCtr.style.height = h;

  var ctx = miniMap.getContext("2d");

  ctx.fillStyle = "white";
  ctx.fillRect(0,0,miniMap.width,miniMap.height);

  // loop through all blocks on the map
  for (var y=0;y<mapHeight;y++) {
    for (var x=0;x<mapWidth;x++) {

      var wall = map[y][x];

      if (wall > 0) { // if there is a wall block at this (x,y) ...

        ctx.fillStyle = "rgb(200,200,200)";
        ctx.fillRect(         // ... then draw a block on the minimap
          x * miniMapScale,
          y * miniMapScale,
          miniMapScale,miniMapScale
        );

      }
    }
  }

  updateMiniMap();
}

setTimeout(init, 1);

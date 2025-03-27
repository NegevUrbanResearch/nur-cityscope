var slideIndex = 0;
var playingSlideshow = false;
var currentTimeout;
var appSettings = null;
let shiftHolder = 0;
var infoDiv = document.getElementById("info");

/**
 *
 * @param {
* }
*/

//go full screen
function toggleFullScreen() {
   var doc = window.document;
   var docElement = doc.documentElement;
   //
   var requestFullScreen =
       docElement.requestFullscreen ||
       docElement.mozRequestFullScreen ||
       docElement.webkitRequestFullScreen ||
       docElement.msRequestFullscreen;
   //
   var cancelFullScreen =
       doc.exitFullscreen ||
       doc.mozCancelFullScreen ||
       doc.webkitExitFullscreen ||
       doc.msExitFullscreen;
   //
   if (
       !doc.fullscreenElement &&
       !doc.mozFullScreenElement &&
       !doc.webkitFullscreenElement &&
       !doc.msFullscreenElement
   ) {
       requestFullScreen.call(docElement);
   } else {
       cancelFullScreen.call(doc);
   }
}


// INTERACTION

//interaction
document.body.addEventListener(
    "keydown",
    event => {
        const keyName = event.key;
        const keyCode = event.keyCode;

        // if (keyName == "ArrowLeft") {
        //     prevSlide();
        // } else if (keyName == "ArrowRight") {
        //     nextSlide();
        // } else
        if (keyCode == 70) {
            toggleFullScreen();
            // let ui = document.getElementById("logo");
            // if (ui.style.display !== "none") {
            //     ui.style.display = "none";
            // } else {
            //     ui.style.display = "block";
            // }
        }
        // } else if (keyName == "P") {
        //     togglePlayPause();
        // }
    },
    false
);
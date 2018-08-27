import * as bundle from './bundle-url';

function updateLink(link) {
    var newLink = link.cloneNode();
    newLink.onload = function () {
        link.remove();
    };
    newLink.href = link.href.split('?')[0] + '?' + Date.now();
    link.parentNode.insertBefore(newLink, link.nextSibling);
}

var cssTimeout = null;
export default function reloadCSS() {
    if (cssTimeout) {
        return;
    }

    cssTimeout = setTimeout(function () {
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            if (bundle.getBaseURL(links[i].href) === bundle.getBundleURL()) {
                updateLink(links[i]);
            }
        }

        cssTimeout = null;
    }, 50);
}

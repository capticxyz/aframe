var registerComponent = require('../core/component').registerComponent;

registerComponent('disable-grabbable', {
  init: function () {
    this.el.setAttribute('obb-collider', 'centerModel: true');
  }
});

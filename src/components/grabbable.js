var registerComponent = require('../core/component').registerComponent;

registerComponent('grabbableno', {
  init: function () {
    this.el.setAttribute('obb-collider', 'centerModel: true');
  }
});

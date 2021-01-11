import { API, HAP, IndependentPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import smartcast, { Device } from 'vizio-smart-cast';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */

let hap: HAP;

export = (api: API) => {
  hap = api.hap;

  api.registerPlatform(PLATFORM_NAME, HomebridgeVizioSoundbar);
};

class HomebridgeVizioSoundbar implements IndependentPlatformPlugin {

  private soundbar: Device; 
  private televisionService: Service;
  private speakerService: Service;
  private inputIDs: Record<number, string> = {};
  private currentInputID = 0;

  public accessory: PlatformAccessory;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.soundbar = new smartcast(this.config.ip as string);
    this.log.debug('Finished initializing platform:', this.config.name);

    const uuid = hap.uuid.generate('homebridge:vizio-soundbar:accessory:' + this.config.name);
    this.accessory = new api.platformAccessory('Vizio Soundbar', uuid);
    this.accessory.getService(hap.Service.AccessoryInformation)!
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Vizio')
      .setCharacteristic(hap.Characteristic.Model, 'Soundbar');

    this.televisionService = new hap.Service.Television(this.config.name ?? 'TV', 'televisionService');
    this.speakerService = new hap.Service.TelevisionSpeaker(this.config.name + ' Speaker', 'speakerService');
    this.prepareTelevisionService();
    this.prepareSpeakerService();
    this.prepareInputsService();

    api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  //Prepare television service
  prepareTelevisionService() {
    this.log.debug('prepareTelevisionService');
    this.televisionService.setCharacteristic(hap.Characteristic.ConfiguredName, this.config.name ?? 'TV');
    this.televisionService.setCharacteristic(
      hap.Characteristic.SleepDiscoveryMode,
      hap.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );

    this.televisionService.getCharacteristic(hap.Characteristic.Active)
      .on('get', this.getPower.bind(this))
      .on('set', this.setPower.bind(this));

    this.televisionService.getCharacteristic(hap.Characteristic.ActiveIdentifier)
      .on('get', this.getInput.bind(this))
      .on('set', this.setInput.bind(this));

    this.televisionService.getCharacteristic(hap.Characteristic.RemoteKey)
      .on('set', this.setRemoteKey.bind(this));

    this.accessory.addService(this.televisionService);
  }

  //Prepare speaker service
  prepareSpeakerService() {
    this.log.debug('prepareSpeakerService');
    this.speakerService
      .setCharacteristic(hap.Characteristic.Active, hap.Characteristic.Active.ACTIVE)
      .setCharacteristic(hap.Characteristic.VolumeControlType, hap.Characteristic.VolumeControlType.ABSOLUTE);
    this.speakerService.getCharacteristic(hap.Characteristic.VolumeSelector)
      .on('set', this.setVolumeSelector.bind(this));
    this.speakerService.getCharacteristic(hap.Characteristic.Volume)
      .on('get', this.getVolume.bind(this))
      .on('set', this.setVolume.bind(this));
    this.speakerService.getCharacteristic(hap.Characteristic.Mute)
      .on('get', this.getMute.bind(this))
      .on('set', this.setMute.bind(this));

    this.accessory.addService(this.speakerService);
    this.televisionService.addLinkedService(this.speakerService);
  }


  async prepareInputsService() {
    this.log.debug('prepareInputsService');
    const inputs = await this.soundbar.input.list();


    inputs.ITEMS.forEach((input, i) => {
      //get input name		
      const inputName = input.NAME as string;
      this.log.debug('Found %s', inputName);

      const inputsService = new hap.Service.InputSource(inputName, 'input' + i);
      this.inputIDs[i] = inputName;

      inputsService
        .setCharacteristic(hap.Characteristic.Identifier, i)
        .setCharacteristic(hap.Characteristic.ConfiguredName, inputName)
        .setCharacteristic(hap.Characteristic.IsConfigured, hap.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(hap.Characteristic.InputSourceType, hap.Characteristic.InputSourceType.HDMI)
        .setCharacteristic(hap.Characteristic.CurrentVisibilityState, hap.Characteristic.CurrentVisibilityState.SHOWN);

      this.accessory.addService(inputsService);
      this.televisionService.addLinkedService(inputsService);
    });
  }

  getInput(callback) {
    let inputIdentifier = 0;
    if (this.currentInputID >= 0) {
      inputIdentifier = this.currentInputID;
    }
    callback(null, inputIdentifier);
  }

  setInput(inputID, callback) {
    const inputName = this.inputIDs[inputID];
    this.currentInputID = inputID;
    this.soundbar.input.set(inputName);
    callback(null);
  }

  async getVolume(callback) {
    const values = await this.soundbar.control.volume.get();
    const volume = values.ITEMS[0].VALUE;
    this.log.debug('Successfully got soundbar volume: %s', volume);
    callback(null, volume);
  }

  setVolume(volume, callback) {
    this.log.debug('Setting soundbar volume to %s', volume);
    if (volume >= 0 && volume <= 100) {
      this.soundbar.control.volume.set(volume);
    }
    callback(null);
  }

  async getMute(callback) {
    const values = await this.soundbar.control.volume.getMuteState();
    const state = values.ITEMS[0].VALUE === 'On';
    callback(null, state);
  }

  setMute(state, callback) {
    this.log.debug('Setting soundbar mute to %s', state);
    if (state) {
      this.soundbar.control.volume.mute();
    } else {
      this.soundbar.control.volume.unmute();
    }
    callback(null);
  }

  setVolumeSelector(state, callback) {
    switch(state) {
      case hap.Characteristic.VolumeSelector.INCREMENT:
        this.soundbar.control.volume.up();
        break;
      case hap.Characteristic.VolumeSelector.DECREMENT:
        this.soundbar.control.volume.down();
        break;
    }
    callback(null);
  }

  async getPower(callback) {
    const values = await this.soundbar.power.currentMode();
    let state = false;
    if (values.ITEMS[0].VALUE === 1) {
      state = true;
    }
    callback(null, state);
  }

  setPower(state, callback) {
    if (state) {
      this.soundbar.control.power.on();
    } else {
      this.soundbar.control.power.off();
    }
    callback(null);
  }

  setRemoteKey(remoteKey, callback) {
    //TODO implement
    callback(null);
  }
}

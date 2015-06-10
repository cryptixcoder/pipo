function EncryptionManager() {
  this.keyPair = ({
    publicKey: null,
    privateKey: null
  });

  //this.masterKeyPair = ({
  //  password: 'pipo',
  //  id: null,
  //  publicKey: null,
  //  privateKey: null,
  //  encryptedPrivateKey: null
  //});

  // Should update this setting from the server using getConfig and configUpToDate
  this.encryptionScheme = {};

  this.keyManager = null;
  this.masterKeyManager = null;
  this.keyRing = new window.kbpgp.keyring.KeyRing();
  this.clientCredentialsLoaded = false;
  this.masterCredentialsLoaded = false;
  this.clientCredentailsDecrypted = false;
  this.masterCredentailsDecrypted = false;
}

/**
 * Generates a new keypair for this manager
 * @param numBits
 * @param userId
 * @param passphrase
 * @param callback
 */
EncryptionManager.prototype.generateClientKeyPair = function generateClientKeyPair(numBits, userId, passphrase, callback) {
  var self = this;
  var options = {
    numBits: numBits,
    userId: userId,
    passphrase: passphrase
  };

  console.log("Generating client keypair, please wait...");

  window.openpgp.generateKeyPair(options).then(function(keys) {
    self.keyPair = {
      privateKey: keys.privateKeyArmored,
      publicKey: keys.publicKeyArmored
    };
    return callback(null, self.keyPair);
  }).catch(function(err) {
    return callback(err, null);
  });
};

/**
 * Attemtps to load stored PGP key from localStorage and initalize all internal variables
 * @param callback(err, loaded)
 */
EncryptionManager.prototype.loadClientKeyPair = function loadClientKeyPair(callback) {
  var self = this;
  // If credentials are already loaded return true and move on
  if (self.clientCredentialsLoaded) {
    console.log("Client credentials already loaded...");
    return callback(null, true);
  }
  console.log("[LOAD CLIENT KEY PAIR] Loading client key pair from local storage");
  var keyPairData = localStorage.getItem('keyPair');
  // If we have a local client keypair, load it and try to parse from JSON
  if (keyPairData) {
    console.log("[LOAD CLIENT KEY PAIR] Loaded client key pair from local storage!");
    try {
      keyPairData = JSON.parse(keyPairData);
    }
    catch(err) {
      console.log("Error parsing keyPair data from localStorage", e);
      return callback(err, false);
    }
  } else {
    console.log("[ENCRYPTION MANAGER] (loadClientKeyPair) No keyPairData found in local storage...");
    return callback(null, false);
  };

  //Load decrypted key into keyRing
  kbpgp.KeyManager.import_from_armored_pgp({
    armored: keyPairData.privateKey
  }, function(err, keyManager) {
    if (err) {
      console.log("Error loading key", err);
      return callback(err);
    } else {
      self.keyManager = keyManager;
      if (keyManager.is_pgp_locked()) {
        self.unlockClientKey(function(err) {
          if (err) {
            console.log("[ENCRYPTION MANAGER] (loadClientKeyPair) Error decrypting client key pair", err);
            return callback(err, null);
          }
          console.log("[ENCRYIPTION MANAGER] (loadClientKeyPair) Decrypted client key!");
          window.encryptionManager.keyManager.sign({}, function(err) {
            window.encryptionManager.keyManager.export_pgp_public({}, function(err, publicKey) {
              if (err) {
                return console.log("[loadClientKeyPair] Error getting public key from keyManager", err);
              }
              if (!publicKey) {
                return console.log("[loadClientKeyPair] publicKey is NULL!");
              }
              self.clientCredentialsLoaded = true;
              return callback(null, true);
            });
          });
        });
      }
    }
  });
};

/**
 * Attemtps to load stored PGP key from localStorage and initalize all internal variables
 * @param callback(err, loaded)
 */
EncryptionManager.prototype.loadMasterKeyPair = function loadMasterKeyPair(room, masterKeyPair, callback) {
  var self = this;
  if (masterKeyPair) {
    // MasterKey mode
    console.log("[ENCRYPTION MANAGER] masterKeyPair found! client keyManager locked", self.keyManager.is_pgp_locked().toString());

    if (self.keyManager.is_pgp_locked()) {
      return console.log("[ENCRYPTION MANAGER] (loadMasterKeyPair) Client keyManager is locked! :(");
    }
    if (!masterKeyPair.encryptedPrivateKey) {
      return console.log("[ENCRYPTION MANAGER] (loadMasterKeyPair) No master key provided to loadMasterKeyPair! encryptedMasterPrivateKey is NULL");
    }

    // Decrypt master key and add to keyRing
    console.log("[ENCRYPTION MANAGER] (loadMasterKeyPair) Decrypting master key");

    self.decryptMasterKey(masterKeyPair.encryptedPrivateKey, function(err, masterPrivateKey) {
      window.encryptionManager.getKeyManager({
        publicKey: masterKeyPair.publicKey,
        privateKey: masterPrivateKey,
        passphrase: ''
      }, function(err, keyManager) {
        self.masterKeyManager = keyManager;
        // Unlock and add masterKeyManager to keyRing
        window.encryptionManager.unlockMasterKey(room, function(err) {
          if (err) {
            return callback(err, false);
          }
          self.masterCredentialsLoaded = true;
          console.log("[ENCRYPTION MANAGER] (loadMasterKeyPair) Unlock master key pair complete!");
          return callback(err, true);
        });
      });
    });
  } else {
    // ClientKey mode
    console.log("[ENCRYPTION MANAGER] (loadMasterKeyPair) CLIENT KEY MODE!");
  }
};

/*
* create a KeyManager from object containing publicKey and privateKey
*/
EncryptionManager.prototype.getKeyManager = function getKeyManager(data, callback) {
  var privateKey = data.privateKey;
  var publicKey = data.publicKey;
  var passphrase = data.passphrase;

  console.log("[ENCRYPTION MANAGER] (getKeyManager) Starting KeyManager creation with privateKey: "+privateKey+" publicKey: "+publicKey+" passphrase: "+passphrase);
  console.log("[ENCRYPTION MANAGER] (getKeyManager) Starting KeyManager creation");

  kbpgp.KeyManager.import_from_armored_pgp({
    armored: privateKey
  }, function(err, keyManager) {
    if (err) {
      return callback(err);
    }
    if (keyManager.is_pgp_locked()) {
      keyManager.unlock_pgp({
        passphrase: passphrase
      }, function(err) {
        if (err) {
          return callback(err);
        }
        keyManager.sign({}, function(err) {
          if (err) {
            return callback(err);
          }
          console.log("Loaded private key with passphrase");
          return callback(err, keyManager);
        });
      });
    } else {
      console.log("Loaded private key w/o passphrase");
      return callback(err, keyManager);
    }
  });
};

EncryptionManager.prototype.unlockClientKey = function unlockClientKey(callback) {
  var self = this;
  //Unlock key with passphrase if locked
  if (self.keyManager.is_pgp_locked()) {
    var tries = 3;
    promptAndDecrypt();

    function promptAndDecrypt() {
      console.log("[ENCRYPTION MANAGER] (unlockClientKey) Prompting for password to decrypt client key...");
      ChatManager.promptForPassphrase(function (passphrase) {
        self.keyManager.unlock_pgp({
          passphrase: passphrase
        }, function (err) {
          if (err) {
            if (tries) {
              tries--;
              return promptAndDecrypt();
            }
            console.log("Error unlocking key", err);
            return callback(err);
          }
          console.log("[ENCRYPTION MANAGER] (unlockClientKey) Successfully decrypted client key");
          //self.keyManager = keyManager;
          self.keyRing.add_key_manager(self.keyManager);

          self.clientCredentialsDecrypted = true;

          return callback(null);
        });
      });
    }
  }
  else {
    self.keyRing.add_key_manager(keyManager);
    return callback(null);
  }
};

EncryptionManager.prototype.unlockMasterKey = function unlockMasterKey(room, callback) {
  //Unlock key with passphrase if locked
  var self = this;
  console.log("(unlockMasterKey) self.masterKeyManager.is_gpg_locked(): "+self.masterKeyManager.is_pgp_locked());
  if (self.encryptionScheme[room] == 'masterKey' && self.masterKeyManager.is_pgp_locked()) {
    var tries = 3;
    decryptMaster();

    function decryptMaster() {
      self.masterKeyManager.unlock_pgp({
        passphrase: 'pipo'
      }, function (err) {
        if (err) {
          console.log("Error unlocking key", err);
          return callback(err);
        }

        //self.masterKeyManager = masterKeyManager;
        self.keyRing.add_key_manager(self.masterKeyManager);

        self.masterCredentialsDecrypted = true;

        return callback(null);
      });
    }
  }
  else {
    self.keyRing.add_key_manager(self.masterKeyManager);
    console.log("[UNLOCK MASTER KEY] Added passwordless masterKey to keyring");
    return callback(null);
  }
};


/**
 * Encrypts a message to all keys in the room
 * @param room
 * @param message
 * @param callback
 */
EncryptionManager.prototype.encryptRoomMessage = function encryptRoomMessage(data, callback) {
  var room = data.room;
  var message = data.message;
  var self = this;

  //Encrypt the message
  if (self.encryptionScheme[room] == "masterKey") {
    console.log("[ENCRYPT ROOM MESSAGE] Using masterKey scheme");
    self.encryptMasterKeyMessage(room, message, function(err, pgpMessage) {
      callback(err, pgpMessage );
    });
  } else if (self.encryptionScheme[room] == "clientKey") {
    console.log("[ENCRYPT ROOM MESSAGE] Using clientKey scheme");
    console.log("[DEBUG] Encrypting message: "+message+" for room: "+room);
    self.encryptClientKeyMessage(room, message, function(err, pgpMessage) {
      callback(err, pgpMessage );
    });
  } else {
    console.log("[ENCRYPT ROOM MESSAGE] Using default scheme");
    self.encryptClientKeyMessage(room, message, function(err, pgpMessage) {
      callback(err, pgpMessage );
    });
  }
};

/**
 * Encrypts messages to the master key if we are using
 * master key room message encryption
 */
EncryptionManager.prototype.encryptMasterKeyMessage = function encryptMasterKeyMessage(room, message, callback) {
  var self = this;
  window.kbpgp.box({
    msg: message,
    encrypt_for: self.masterKeyManager,
    sign_with: self.keyManager,
  }, callback);
};

EncryptionManager.prototype.encryptClientKeyMessage = function encryptClientKeyMessage(room, message, callback) {
  var self = this;
  //Build array of all users' keyManagers
  var keys = Object.keys(window.roomUsers[room]).map(function(userName) {
    return window.userMap[userName].keyInstance;
  }).filter(function(key) {
    return !!key;
  });

  //Add our own key to the mix so that we can read the message as well
  //TODO: Should have a meyManager for each room
  keys.push(self.keyManager);

  window.kbpgp.box({
    msg: message,
    encrypt_for: keys,
    sign_with: self.keyManager
  }, callback);
};

EncryptionManager.prototype.encryptPrivateMessage = function encryptPrivateMessage(username, message, callback) {
  var self = this;
  window.kbpgp.box({
    msg: message,
    encrypt_for: window.userMap[username].keyInstance,
    sign_with: self.keyManager
  }, callback);
};

/**
 * Decrypts an incoming message with our key
 * @param encryptedMessage
 * @param callback
 */
 //TODO: Should name this appropriately for client key decryption
EncryptionManager.prototype.decryptMessage = function decryptMessage(encryptedMessage, callback) {
  console.log("[ENCRYPTION MANAGER] (decryptMessage) Decrypting clientKey message");
  window.kbpgp.unbox({
    keyfetch: this.keyRing,
    armored: encryptedMessage
  }, callback);
};

//TODO: Should name this appropriately for master key decryption
EncryptionManager.prototype.decryptMasterKeyMessage = function decryptMasterKeyMessage(pgpMessage, callback) {
  window.kbpgp.unbox({
    keyfetch: this.keyRing,
    armored: pgpMessage
  }, callback);
};

//TODO: Determine if these are needed

EncryptionManager.prototype.removeClientKeyPair = function removeClientKeyPair(fs, callback) {
  fs.root.getFile('clientkey.aes', {create: false}, function(fileEntry) {
    fileEntry.remove(function() {
      console.log('File successufully removed.');
      fs.root.getFile('clientkey.pub', {create: false}, function(fileEntry) {
        fileEntry.remove(function() {
          console.log('File successufully removed.');
          callback(null);
        }, errorHandler);
      }, errorHandler);
    }, errorHandler);
  }, errorHandler);
  function errorHandler(err) {
    var msg = '';
    switch(err.name) {
      case "BAD":
        console.log("Bad");
        return callback(err.message);
      default:
        message = 'Unknown Error: '+err.name;
        return callback(err.message);
    };
    console.log("Error: "+message);
  };
};

EncryptionManager.prototype.saveClientKeyPair = function saveClientKeyPair(data, callback) {
  var keyPair = data.keyPair;
  // TODO: Save with username in namespace of key name?
  localStorage.setItem('keyPair', JSON.stringify(keyPair));
  callback(null);
}

EncryptionManager.prototype.initStorage = function initStorage(callback) {
  //Taking care of the browser-specific prefix
  window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;
  window.requestFileSystem(window.PERSISTENT, 1024*1024,onInitFs, function(err) {
    console.log("Error initStorage: "+err);
  });
  function onInitFs(fs) {
    console.log("[INIT STORAGE] Initializing storage...");
    // First check how much we can use in the Persistent storage.
    fs = fs;
    navigator.webkitPersistentStorage.queryUsageAndQuota(
      function (usage, quota) {
        var availableSpace = quota - usage;
        console.log("availableSpace: "+availableSpace);
        if (availableSpace >= amountOfSpaceNeeded) {
          console.log("Have as much space as we need!");
          return callback(null, fs);
        }
        var requestingQuota = amountOfSpaceNeeded + usage;
        navigator.webkitPersistentStorage.requestQuota(
            requestingQuota,
            function (grantedQuota) {
              console.log("Didn't have enough space so requested more. Got: "+grantedQuota);
              return callback(null, fs)
            },
            onError);
      }, onError
    );
    function onError(err) {
      console.log("Got error during init storage: "+err);
      callback(err);
    }
  };
};


EncryptionManager.prototype.decryptMasterKey = function decryptMasterKey(encryptedMasterPrivateKey, callback) {
  var self = this;
  if (!encryptedMasterPrivateKey) { console.log("[ENCRYPTION MANAGER] (decryptMasterKey) encryptedMasterPrivateKey is NULL!") };
  if (!self.keyRing) { console.log("[ENCRYPTION MANAGER] (decryptMasterKey) self.keyRing is NULL!") };
  console.log("[ENCRYPTION MANAGER] (decryptMasterKey) Start...");
  kbpgp.unbox({keyfetch: self.keyRing, armored: encryptedMasterPrivateKey}, function(err, literals) {
    if (err != null) {
      return console.log("Problem: " + err);
    } else {
      var decryptedMasterPrivateKey = null;
      console.log("[ENCRYPTION MANAGER] (decryptMasterKey) Decrypted master key");
      //console.log(literals[0].toString());
      decryptedMasterPrivateKey = literals[0].toString();
      var ds = km = null;
      ds = literals[0].get_data_signer();
      if (ds) { km = ds.get_key_manager(); }
      if (km) {
        console.log("[ENCRYPTION MANAGER] (decryptMasterKey) Signed by PGP fingerprint");
        console.log(km.get_pgp_fingerprint().toString('hex'));
        return callback(err, decryptedMasterPrivateKey);
      }
      console.log("[ENCRYPTION MANAGER] (decryptMasterKey) Unsigned key");
      return callback(err, decryptedMasterPrivateKey);
    }
  });
};

EncryptionManager.prototype.getMasterKeyPair = function getMasterKeyPair(userName, callback) {
  var timestamp = new Date().toString();
  console.log("["+timestamp+"] Getting master keyPair for "+userName);
  $.ajax({
    type: "GET",
    url: "/key/masterKeyPair",
    dataType: "json",
    data: {
      userName: userName
    },
    statusCode: {
      404: function(err) {
        console.log("["+timestamp+"] [MASTER KEY PAIR] (404) Error getting master keypair: "+err);
        return callback(err, null);
      },
      200: function(data) {
        console.log("["+timestamp+"] [MASTER KEY PAIR] (200) Encrypted masterKeyPair retrieved and cached");
        //console.log("[GET MASTER KEY PAIR] data.keyId: "+data.keyId+" data.publicKey: "+data.publicKey+" data.encryptedPrivateKey: "+data.encryptedPrivateKey);
        //TODO: add the keys to a keyManager here and save them to self

        kbpgp.KeyManager.import_from_armored_pgp({
          armored: data.privateKey
        }, function(err, masterKeyPair) {
          if (err) {
            return callback(err);
          }
          if (masterKeyPair.is_pgp_locked()) {
            masterKeyPair.unlock_pgp({
              passphrase: ''
            }, function(err) {
              if (err) {
                return callback(err);
              }
              console.log("Loaded private key with passphrase");
              localStorage.setItem('masterKeyPair', JSON.stringify(data));
              self.masterKeyManager = masterKeyPair;
            });
          } else {
            console.log("Loaded private key w/o passphrase");
            localStorage.setItem('masterKeyPair', JSON.stringify(data));
            self.masterKeyManager = masterKeyPair;
          }
        });
      }
    }
  });
};

// TODO: Change references from updateRemotePublicKey to verifyRemotePublicKey
EncryptionManager.prototype.verifyRemotePublicKey = function verifyRemotePublicKey(userName, publicKey, callback) {
  console.log("Verifying remote public key for user '"+userName+"'");
  $.ajax({
    type: "GET",
    url: "/key/publickey",
    dataType: "json",
    data: {
      userName: userName
    },
    statusCode: {
      404: function(data) {
        console.log("No key found on remote");
        return callback(null, false);
      },
      200: function(data) {
        //console.log("[DEBUG] (updateRemotePublicKey) data: "+data);
        var remotePublicKey = data.publicKey;
        console.log("Key exists on remote");
        console.log("Remote Pub Key: "+data.publicKey);
        console.log("Local Pub Key: "+publicKey);
        if (publicKey == remotePublicKey) {
          console.log("Key on remote matches local");
          return callback(null, true);
        } else {
          console.log("Key on remote does not match");
          return callback(null, false);
        };
      }
    }
  });
};

//TODO: Yes... I know this is a duplicate. Will deal with it later.
EncryptionManager.prototype.updatePublicKeyOnRemote = function updatePublicKeyOnRemote(userName, publicKey, callback) {
  console.log("Updating public key on remote");
  $.ajax({
    type: "POST",
    url: "/key/publickey",
    dataType: "json",
    data: {
      userName: userName,
      publicKey: publicKey
    },
    success: function(data, textStatus, xhr) {
    },
    statusCode: {
      404: function() {
        console.log("Got 404 when updating public key on remote");
        return callback("Error updating public key on remote");
      },
      200: function(data, textStatus, xhr) {
        console.log("Updated remote publicKey successfully");
        return callback(null);
      }
    }
  });
};

EncryptionManager.prototype.verifyCertificate = function verifyCertificate(certificate, callback) {
  var self = this;
  var rawPayload = atob(certificate.payload);
  var storedPayloadHash = localStorage.getItem('serverPayloadHash');

  self.sha256(rawPayload).then(function(payloadHash) {
    if (storedPayloadHash && payloadHash !== storedPayloadHash) {
      return alert("For security reasons we have prevented the application from attempting to authenticate as the Admin Certificate has changed!\n\nThe Admin Certificate hash does not match our previously recorded hash.\n\nIf this change was expected you may reset the hash, if not please contact the administrator of this server");
    }
    else if (storedPayloadHash) {
      console.log("Admin certificate hash matches previously stored hash, skip full verification");
      return callback();
    }

    var rawSignatures = certificate.signatures.map(function (signature) {
      return atob(signature.data);
    });

    var parsedPayload = JSON.parse(rawPayload);
    var fingerprints = parsedPayload.map(function (admin) {
      return admin.fingerprint;
    });

    self.loadAdminKeys(certificate, function (err) {
      window.async.eachSeries(rawSignatures, function (signature, callback) {
        var fingerprint, index;
        self.decryptMessage(signature, function (err, message) {
          if (err) {
            console.log(err);
            return callback(err);
          }

          fingerprint = message[0].get_data_signer().get_key_manager().get_pgp_fingerprint_str();
          index = fingerprints.indexOf(fingerprint);

          if (index === -1) {
            return callback("Admin certificate is not valid \nUnknown admin certificate signer with fingerprint: " + fingerprint);
          }

          var regex = /\r?\n|\r/g
          var parsedMessage = message[0].toString().replace(regex, '');
          var parsedPayload = rawPayload.toString().replace(regex, '');

          if (parsedMessage !== parsedPayload) {
            return callback("Admin certificate not valid: \nAdmin signature does not match payload " + fingerprint);
          }
          fingerprints.splice(index, 1);
          callback();
        });
      }, function (err) {
        if (err) {
          return alert(err + "\n\nFor security reasons we have prevented the application from attempting to authenticate.\n\nIf you are the administrator for this server please verify your configuration files are correctly setup.\n\nIf you are an end user, please contact the administrator via secure means to determine if the server has been compromised.");
        }
        if (!storedPayloadHash) {

          localStorage.setItem('serverPayloadHash', payloadHash.toString());
        }
        console.log("Admin certificate appears to be valid");
        callback();
      });
    });
  });
};

EncryptionManager.prototype.loadAdminKeys = function loadadminKeys(certificate, callback) {
  var self = this;
  var rawAdminKeyData = localStorage.getItem('adminKeys');
  var adminKeyData;

  try {
    adminKeyData = JSON.parse(rawAdminKeyData);
  }
  catch (e) {
    console.log(e);
  }

  if (!adminKeyData) {
    adminKeyData = certificate.keys;
  }

  if (!adminKeyData) {
    return console.error("No known admin keys!", adminKeyData);
  }

  window.async.each(adminKeyData, function(keyData, callback) {
    var rawKey = atob(keyData.data);
    window.kbpgp.KeyManager.import_from_armored_pgp({
      armored: rawKey
    }, function(err, keyManager) {
      self.keyRing.add_key_manager(keyManager);
      callback();
    });
  }, callback);
};

EncryptionManager.prototype.hex = function hex(buffer) {
  var hexCodes = [];
  var view = new DataView(buffer);

  for (var i = 0; i < view.byteLength; i += 4) {
    var value = view.getUint32(i);
    var stringValue = value.toString(16);
    var padding = '00000000';
    var paddedValue = (padding + stringValue).slice(-padding.length);
    hexCodes.push(paddedValue);
  }

  return hexCodes.join("");
};

EncryptionManager.prototype.sha256 = function hash(data) {
  var self = this;
  var buffer = new TextEncoder("utf-8").encode(data);

  return window.crypto.subtle.digest("SHA-256", buffer).then(function (hash) {
    return self.hex(hash);
  });
};

window.encryptionManager = new EncryptionManager();

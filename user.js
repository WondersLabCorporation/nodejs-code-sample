var User = function(adapters, mongoose) {
	var schema = new mongoose.Schema({
		ObjectId		: mongoose.Schema.ObjectId,
		auth_token		: String,
		at_last_check	: Date,
		id				: String,
		name			: String,
		birthday		: String,
		gender			: String,
		country			: String,
		picture			: String,
		video			: String,
		parameters		: Object,
		location_state	: String,
		location		: {
			type: [Number],
			index: '2dsphere',
		},
		online			: Boolean,
		online_last		: Date,
		friends			: [{
			type: mongoose.Schema.Types.ObjectId,
			ref: 'user',
		}],
		fbFriends		: Array,
		invited_friends : Boolean,
		autoAddFriends	: Boolean,
	});
	schema.index({location: '2dsphere'});

	var User = mongoose.model('user', schema)

	var onlineTimer = 900; // 60 seconds
	var lastActivities = [];

	var objectAssign = require('object-assign');

	return {
		getAdapter: function(userId) {
			var key = userId.match(/^[a-z]+/)[0];
			return adapters[key].setId(userId) || false;
		},
		addUser: function(type, token, callback) {
			var _adapter = adapters[type];
			if (typeof _adapter === 'undefined') {
				throw new Error('Unknown authentication adapter');
			}

			var _self = this,
				_callbackData;

			_adapter.auth(token, function(result) {
				if (result.success) {
					User.findOne({id: result.data.id}, function(err, res) {
						if (!res) {
							userData = {
								id: result.data.id,
								name: result.data.name,
								gender: result.data.gender,
								birthday: result.data.birthday,
								country: result.data.country,
								location: result.data.location,
								location_state: result.data.location_state,
								auth_token: result.data.auth_token,
								at_last_check: new Date(),
								parameters: {},
								online: 1,
								invited_friends: 0,
								autoAddFriends: 1,
							};

							var userEntry = new User(userData)
							userEntry.save();

							_callbackData = objectAssign({success: true, firsttime: true}, userData);
						} else {
							userData = {
								id: res.id,
								name: res.name,
								gender: res.gender,
								birthday: res.birthday,
								country: res.country,
								location: res.location,
								picture: res.picture,
								video: res.video,
								invited_friends: (res.invited_friends) ? 1 : 0,
								autoAddFriends: (res.autoAddFriends) ? 1 : 0,
							}

							_callbackData = objectAssign({success: true, firsttime: false}, userData);
						}

						User.update({id: result.data.id}, {
							auth_token: token,
							at_last_check: new Date(),
							online: true,
							online_last: new Date(),
						}, function(){
							if (typeof callback === 'function') {
								callback(_callbackData);
							}
						});
					});
					return;
				} else {
					_callbackData = {error: true, reason: result.reason};

					if (typeof callback === 'function') {
						callback(_callbackData);
					}
				}
			});
		},

		setFbFriends: function(id, friendsIds, callback) {
			User.update({id: id}, {fbFriends: friendsIds}, function(err, result) {
				if (result.nModified > 0) {
					callback(true);
				} else {
					callback(false);
				}
			});
		},

		moveFriendsFBtoCC: function(id, callback, ignoreFlag) {
			var self = this;

			User.findOne({id: id}, function(err, _user) {
				if (!_user) {
					callback({error: true, reason: 'User not found'});
					return;
				}

				var _fbf = _user.fbFriends,
					_f = _user.friends;

				User.find({id: {$in: _fbf}}, function(err, fbFriendsCC) {
					var _usersIds = [];

					if (fbFriendsCC) {
						for (var i in fbFriendsCC) {
							if (!fbFriendsCC[i].autoAddFriends && !ignoreFlag) {
								continue;
							}

							_usersIds.push(fbFriendsCC[i]._id);

							self.addFriend(fbFriendsCC[i].id, id, function(){});
						}
					}

					self.addFriends(id, _usersIds, function() {
						callback();
					});
				});

			});
		},

		getFriends: function(type, token, callback) {
			var _adapter = adapters[type];
			if (typeof _adapter === 'undefined') {
				throw new Error('Unknown authentication adapter');
			}

			var _self = this,
				_callbackData;

			_adapter.getFriends(token, function(result) {
				// console.log(result);
				callback(result);
			});
		},

		syncFriends: function(userId, callback) {
			var self = this;

			User.findOne({id: userId}, function(err, result) {
				var type = userId.split('-')[0];
				var token = result.auth_token;

				self.getFriends(type, token, function(result) {
					var ids = [];
					for (var i in result.data) {
						ids.push('facebook-' + result.data[i].id)
					}

					self.setFbFriends(userId, ids, function(result) {
						if (!result) {
							console.error('Can\'t set FB friends');
						}

						self.moveFriendsFBtoCC(userId, function() {
							callback(true);
						}, true);
					});
				});
			});
		},

		checkUserAccess: function(token, callback) {
			var self = this;

			User.findOne({auth_token: token}, function(err, result) {
				if (!result) {
					adapters.facebook.getId(token, function(result) {
						if (!result.error) {
							var userId = 'facebook-' + result;

							User.findOne({id: userId}, function(err, result) {
								if (result) {
									User.update({id: userId}, {auth_token: token}, function(err, result) {
										callback({id: userId});
										return;
									});
								} else {
									callback({error: true, reason: 'User not found'});
									return;
								}
							});
						} else {
							callback({error: true, reason: 'User not found'});
							return;
						}
					});
				} else {
					if (!result.at_last_check || parseInt(((new Date()).getTime() - (new Date(result.at_last_check)).getTime()) / 1000, 10) > 1800) {
						self.getAdapter(result.id).checkTokenAlive(token, function(alive) {
							if (alive) {
								self.updateTokenCheckTime(result.id, function() {
									callback(result);
									return;
								});
							} else {
								callback({error: true, reason: 'forbidden'});
								return;
							}
						});
					} else {
						callback(result);
						return;
					}
				}
			});
		},

		updateTokenCheckTime: function(id, callback) {
			User.update({id: id}, {at_last_check: new Date()}, function(err, result) {
				callback();
			});
		},

		getUserData: function(id, callback, population) {
			if (typeof population === 'undefined') {
				population = 'friends';
			}

			var self = this;
			User.findOne({id: id}).populate(population).exec(function(err, result) {
				if (result) {
					self.howManyCallMeFriend(id, function(likes) {
						var online = (result.online) ? 1 : 0;
						if (!result.online_last || parseInt(((new Date()).getTime() - (new Date(result.online_last)).getTime()) / 1000, 10) > onlineTimer) {
							online = 0;
						}

						callback({
							_id: result._id,
							id: id,
							name: result.name,
							birthday: result.birthday,
							gender: result.gender,
							country: result.country,
							location_state: result.location_state,
							location: result.location,
							picture: result.picture,
							video: result.video,
							parameters: result.parameters,
							age: Math.floor(Math.abs((new Date(result.birthday)) - (new Date())) / (1000 * 3600 * 24 * 365)),
							friends: result.friends,
							online: online,
							likes: likes,
							invited_friends: (result.invited_friends) ? 1 : 0,
							auto_add_friends: result.autoAddFriends,
						});
					});
				} else {
					callback(false);
				}
			});
		},

		getUserFriends: function(id, callback) {
			var self = this;

			User.findOne({id: id}).populate('friends').exec(function(err, result) {
				var friends = [], _friends;

				if (result) {
					_friends = result.friends || [];

					var totalFriends = 0,
						_counter = 0;

					for (var i in _friends) {
						if (!_friends[i]._id) {
							continue;
						}

						totalFriends++;
					}

					if (totalFriends == 0) {
						callback(friends);
						return;
					}

					for (var i in _friends) {
						var _f = _friends[i];

						if (!_f._id) {
							continue;
						}

						self.getUserData(_f.id, function(user) {
							_counter++;

							var fbFriend = false;
							if (result.fbFriends.indexOf(user.id) !== -1) {
								fbFriend = true;
							}

							if (!user.parameters) {
								user.parameters = {};
							}

							friends.push({
								id: user.id,
								name: user.name,
								gender: user.gender,
								birthday: user.birthday,
								country: user.country,
								location: user.location,
								picture: user.picture,
								fbFriend: fbFriend,
								school: user.parameters.school,
								work: user.parameters.work,
								religion: user.parameters.religion,
								organization: user.parameters.organization,
								online: user.online,
								likes: user.likes,
							});

							if (totalFriends == _counter) {
								callback(friends);
							}
						});
					}
				} else {
					callback({error: true, reason: 'User not found'});
				}
			});
		},

		addFriends: function(id, _ids, callback) {
			if (!_ids) {
				callback(false);
			}

			User.findOne({id: id}, function(err, userResult) {
				if (!userResult) {
					callback({error: true, reason: 'User not found'});
					return;
				}

				for (var i in _ids) {
					var _id = _ids[i];

					if (userResult.friends.indexOf(_id) === -1) {
						// console.log('add ' + _id);
						userResult.friends.push(_id);
					}
				}

				userResult.save(function(err, result) {
					// console.log(err);
					// console.log(result);
					callback({success: true});
				});
			});
		},

		addFriend: function(id, friendId, callback) {
			User.findOne({id: id}, function(err, userResult) {
				if (!userResult) {
					callback({error: true, reason: 'User not found'});
					return;
				}

				User.findOne({id: friendId}, function(err, friendResult) {
					if (!friendResult) {
						callback({error: true, reason: 'User\'s friend not found'});
						return;
					}

					if (userResult.friends.indexOf(friendResult._id) !== -1) {
						callback({error: true, reason: 'User is already a friend'});
						return;
					}

					if (!userResult.friends) {
						userResult.friends = [];
					}

					userResult.friends.push(friendResult._id);
					userResult.save();

					callback({success: true});
				});
			});
		},

		removeFriend: function(id, friendId, callback) {
			User.findOne({id: id}, function(err, userResult) {
				// We decided to not check is this friend from FB or not
				// if (userResult.fbFriends.indexOf(friendId) !== -1) {
				// 	callback({error: true, reason: 'You can\'t remove your facebook friend'});
				// } else {
					User.findOne({id: friendId}, function(err, friendResult) {
						if (friendResult) {
							User.update({id: id}, {$pullAll: {friends: [friendResult._id]}}, function(err, result) {
								if (result.nModified > 0) {
									callback({success: true});
								} else {
									callback({error: true, reason: 'Can\'t remove friend'});
								}
							});
						} else {
							callback({error: true, reason: 'Can\'t find friend'});
						}
					});
				//}
			});
		},

		setLastActivity: function(id) {
			lastActivities[id] = (new Date()).getTime();
		},

		checkLastActivity: function(id) {
			var _la = lastActivities[id];

			// False means this user is inactive
			if (typeof _la === 'undefined' || (new Date()).getTime() - _la > onlineTimer) {
				return false;
			}

			return true;
		},

		parameters: ['religion', 'organization', 'gender', 'location', 'age'],

		setParameters: function(id, parameters, callback) {
			User.findOne({id: id}, function(err, user) {
				if (!user) {
					callback({error: true, reason: 'User not found'});
					return;
				}

				if (!user.parameters) {
					oldParameters = {};
				} else {
					oldParameters = JSON.parse(JSON.stringify(user.parameters));
				}

				user.parameters = {};
				user.save();

				for (var i in parameters) {
					oldParameters[i] = parameters[i];
				}

				user.parameters = JSON.parse(JSON.stringify(oldParameters));
				user.save();

				callback({success: true});
			});
		},

		getParameters: function(id, callback) {
			User.findOne({id: id}, function(err, user) {
				if (!user) {
					callback({error: true, reason: 'User not found'});
					return;
				}

				var parameters  = {};

				if (!!user.parameters) {
					parameters = user.parameters;
				}

				callback(parameters);
			});
		},

		setOnline: function(id, flag, callback) {
			User.update({id: id}, {online: flag, online_last: new Date()}, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while updating online flag'});
					}
				}
			});
		},

		setLocationCoords: function(id, coords, callback) {
			if (typeof coords === 'string') {
				coords = coords.split(',');
			}

			var geocoder = require('geocoder');

			geocoder.reverseGeocode(coords[1], coords[0], function (err, data) {
				var state = '';

				if (data.results.length > 0) {
					var isUS = false;

					for (var i in data.results[0].address_components) {
						var _addressPart = data.results[0].address_components[i];

						if (_addressPart.types[0] == 'country' && _addressPart.short_name == 'US') {
							isUS = true;
						}
					}

					if (isUS) {
						for (var i in data.results[0].address_components) {
							var _addressPart = data.results[0].address_components[i];
							
							if (_addressPart.types[0] == 'administrative_area_level_1') {
								state = _addressPart.short_name;
								break;
							}
						}
					}
				}

				User.update({id: id}, {location: coords, location_state: state}, function(err, result) {
					if (result.nModified > 0) {
						callback({success: true, modified: true});
					} else {
						if (result.ok == 1) {
							callback({success: true, modified: false});
						} else {
							callback({error: true, reason: 'Error while updating location'});
						}
					}
				});
			});
		},

		setGender: function(id, gender, callback) {
			User.update({id: id}, {gender: gender}, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while updating gender'});
					}
				}
			});
		},

		setPicture: function(id, picture, callback) {
			var updateDef = {picture: picture};

			if (!picture) {
				updateDef = {$unset: {picture: 1}};
			}
			
			User.update({id: id}, updateDef, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while updating picture'});
					}
				}
			});
		},

		setVideo: function(id, video, callback) {
			var updateDef = {video: video};

			if (!video) {
				updateDef = {$unset: {video: 1}};
			}

			User.update({id: id}, updateDef, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while updating video'});
					}
				}
			});
		},

		setInvited: function(id, invited_friends, callback) {
			User.update({id: id}, {invited_friends: invited_friends}, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while setting invite flag'});
					}
				}
			});
		},

		setAutoAddFriends: function(id, autoAddFriends, callback) {
			User.update({id: id}, {autoAddFriends: autoAddFriends}, function(err, result) {
				if (result.nModified > 0) {
					callback({success: true, modified: true});
				} else {
					if (result.ok == 1) {
						callback({success: true, modified: false});
					} else {
						callback({error: true, reason: 'Error while setting invite flag'});
					}
				}
			});
		},

		howManyCallMeFriend: function(id, callback, params) {
			User.findOne({id: id}, function(err, _user) {
				User.find({friends: {$in: [_user._id]}}, function(err, result) {
					callback(result.length, params);
				});
			});
		},

		getFilteredUsers: function(caller, filters, callback) {
			var self = this;

			var conditions = {};
			conditions['$and'] = [{video: {$exists: true}}];
			// conditions['$and'] = [];

			for (var filterKey in filters) {
				var filterValue = filters[filterKey];

				switch (filterKey) {
					case 'age':
						// var _ageFrom = 0, _ageTo = 1000;
						// var ageSplit = filterValue.split(',');

						// conditions['$and'].push({age: {$gte: ageSplit[0], $lte: ageSplit[1]}});
						break;
					case 'location_range':
						// Miles

						filterValue *= 1609;

						conditions['$and'].push({location: {
							$near: {
								$geometry: {
									type: 'Point',
									coordinates: caller.location,
								},
								$maxDistance: filterValue,
							}
						}});
						break;
					case 'location_state':
						conditions['$and'].push({location_state: filterValue});
						break;
					case 'gender':
						conditions['$and'].push({gender: new RegExp('^' + filterValue + '$', "i")});
						break;
					default:
						if (filterKey) {
							var param = {};

							if (filterKey == 'any_work' || filterKey == 'any_school') {
								param['parameters.' + filterKey.split('_')[1]] = {$exists: true}
							} else {
								param['parameters.' + filterKey] = filterValue;
							}

							conditions['$and'].push(param);
						}

						break;
				}
			}

			if (conditions['$and'].length == 0) {
				conditions = {};
			}

			User.find(conditions, function(err, result) {
				console.log(err);
				var totalUsers = result.length,
					counter = 0,
					users = [];

				if (totalUsers == 0) {
					callback(users);
				}

				for (var i in result) {
					var _u = result[i];

					self.howManyCallMeFriend(_u.id, function(likes, _u) {
						counter++;

						var match = true;
						var _matchAge = Math.floor(Math.abs((new Date(_u.birthday)) - (new Date())) / (1000 * 3600 * 24 * 365));

						if (filters.age) {
							_ageSplit = filters.age.split(',');
							_ageFrom = _ageSplit[0];
							_ageTo = _ageSplit[1];

							if (_matchAge < _ageFrom || _matchAge > _ageTo) {
								match = false;
							}
						}

						if (caller.id == _u.id) {
							match = false;
						}

						if (match) {
							users.push({
								id: _u.id,
								name: _u.name,
								gender: _u.gender,
								birthday: _u.birthday,
								picture: _u.picture,
								video: _u.video,
								age: _matchAge,
								user_filters: _u.parameters,
								likes: likes,
							});
						}

						if (totalUsers == counter) {
							callback(users);
						}
					}, _u);
				}
			});
		},
	};
};


module.exports = User;
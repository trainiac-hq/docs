// Generated from openapi.v1.json by generate.ts. Do not edit: change the
// contract and run `bun run generate` in shared/api.

/**
 * Live UK rail data from Network Rail's and National Rail's open feeds. Every answer is an Ok or an ErrorResponse, told apart by `type` and by the HTTP status. Every key is always present: null means a value does not exist, and states (cancelled, no information yet, withheld) are union members with a `type`.
 */

/** A public station. */
export type Station = {
	/** Three-letter CRS code. */
	crs: string;
	/** Proper name, e.g. London Paddington. */
	name: string;
};

/** A public station. */
export type PlaceStation = {
	type: "station";
	crs: string;
	name: string;
};

/**
 * A railway location with no public station code: a junction, siding or depot.
 */
export type PlaceLocation = {
	type: "location";
	name: string;
};

/** Somewhere a train is or calls. */
export type Place = PlaceStation | PlaceLocation;

export type Operator = {
	/** ATOC code, e.g. GW. */
	code: string;
	/** e.g. Great Western Railway. null when we have no name for the code. */
	name: string | null;
};

/**
 * What kind of service it is, from the timetable. unknown: no schedule matched.
 */
export type ServiceClass = "passenger" | "bus" | "freight" | "ship" | "trip" | "empty_stock" | "unknown";

/** It has happened, at this time. */
export type EstimateActual = {
	type: "actual";
	/** ISO 8601 with the UK offset, e.g. 2026-10-05T14:26:00+01:00. */
	at: string;
};

/** Expected at this time. */
export type EstimateForecast = {
	type: "forecast";
	/** ISO 8601 with the UK offset, e.g. 2026-10-05T14:26:00+01:00. */
	at: string;
	/**
	 * darwin: National Rail's forecast. live_report: the last TRUST report's lateness carried forward.
	 */
	source: "darwin" | "live_report";
};

/** Known to be late, by an amount nobody can say yet. */
export type EstimateDelayedNoEstimate = {
	type: "delayed_no_estimate";
};

/** Nothing live or forecast is known yet. Not the same as on time. */
export type EstimateNoInformation = {
	type: "no_information";
};

/** The service is cancelled, so this will not happen. */
export type EstimateCancelled = {
	type: "cancelled";
};

/** What is known about when something happens. */
export type Estimate = EstimateActual | EstimateForecast | EstimateDelayedNoEstimate | EstimateNoInformation | EstimateCancelled;

/** A timetabled time and what is known about it. */
export type Time = {
	/** The timetabled time. */
	scheduled: string;
	estimate: Estimate;
	/**
	 * Minutes after scheduled (negative is early) when the estimate has a time; null when it has none.
	 */
	delay_minutes: number | null;
};

export type PlatformKnown = {
	type: "known";
	/** A platform is a string: 4A, 10, B. */
	number: string;
	/**
	 * actual: where TRUST reported it. forecast: Darwin's. timetable: planned only, often wrong at large stations.
	 */
	source: "actual" | "forecast" | "timetable";
};

/** Darwin asks that the platform not be shown yet. */
export type PlatformWithheld = {
	type: "withheld";
};

/** No platform information. */
export type PlatformUnknown = {
	type: "unknown";
};

export type Platform = PlatformKnown | PlatformWithheld | PlatformUnknown;

export type Train = {
	/**
	 * TRUST train id, e.g. 671L50MK02. null until TRUST activates the train.
	 */
	id: string | null;
	/**
	 * Timetable (CIF) uid, e.g. GW001. null where the answer does not identify the schedule.
	 */
	uid: string | null;
	/** e.g. 1L50. Headcodes repeat across the country. */
	headcode: string;
	operator: Operator | null;
};

export type TrainRef = {
	/** TRUST train id. */
	id: string;
	headcode: string;
};

export type ResolutionStation = {
	type: "station";
	crs: string;
	name: string;
};

/** A name for several stations, all of which were searched. */
export type ResolutionGroup = {
	type: "group";
	/** e.g. London Terminals. */
	name: string;
	stations: Station[];
};

export type Resolution = ResolutionStation | ResolutionGroup;

/** A station argument and what it was understood to mean. */
export type StationArgument = {
	/** What was asked for. */
	query: string;
	resolution: Resolution;
};

/**
 * A stop after this station. The time is the arrival where the stop has a public arrival, else the departure.
 */
export type CallingPoint = {
	station: Place;
	time: Time;
	platform: Platform;
};

export type FormationDivides = {
	type: "divides";
	at: Place;
};

export type FormationJoins = {
	type: "joins";
	at: Place;
};

/** The train divides, or joins another portion, later on. */
export type FormationChange = FormationDivides | FormationJoins;

/**
 * The inbound train that physically becomes this one. If it is late, this usually is too.
 */
export type FormedFrom = {
	headcode: string;
	origin: Place;
	/** When the inbound is expected here. null when there is no time for it. */
	expected_arrival: string | null;
};

export type Departure = {
	train: Train;
	service_class: ServiceClass;
	origin: Place;
	destination: Place;
	departs: Time;
	platform: Platform;
	calling_points: CallingPoint[];
	/** Booked arrival at its destination. null when the timetable has none. */
	destination_arrival: string | null;
	/**
	 * Coaches in the formation here, from Darwin. null when Darwin has not said.
	 */
	coaches: number | null;
	formation_changes: FormationChange[];
	formed_from: FormedFrom | null;
	/** Darwin's reason for lateness. null when it has given none. */
	delay_reason: string | null;
	/** false when Darwin asks that this call not be shown on boards. */
	advertised: boolean;
};

export type DeparturesRequest = {
	station: StationArgument;
	calling_at: StationArgument | null;
	/** HH:MM, UK local. null when not given. */
	from_time: string | null;
	/** HH:MM, UK local. null when not given. */
	to_time: string | null;
	limit: number;
};

/**
 * One train, boarded at from and left at to. from is null only when the journey was asked from a group of stations and the itinerary does not say which one it leaves from.
 */
export type Leg = {
	train: Train;
	service_class: ServiceClass;
	from: Place | null;
	departs: Time;
	departure_platform: Platform;
	to: Place;
	arrives: Time;
	arrival_platform: Platform;
	/** Coaches, where Darwin says. null otherwise. */
	coaches: number | null;
};

/** The change between two legs. */
export type Connection = {
	at: Place;
	/** Timetabled minutes between arriving and leaving. */
	minutes: number;
	/**
	 * at_risk: live running leaves less than the minimum interchange. unknown: one side is late with no estimate.
	 */
	outlook: "safe" | "at_risk" | "unknown";
};

export type JourneyDirect = {
	type: "direct";
	departs: Time;
	arrives: Time;
	duration_minutes: number;
	leg: Leg;
};

export type JourneyWithChanges = {
	type: "with_changes";
	departs: Time;
	arrives: Time;
	duration_minutes: number;
	legs: Leg[];
	/** connections[i] is the change from legs[i] to legs[i + 1]. */
	connections: Connection[];
};

export type Journey = JourneyDirect | JourneyWithChanges;

export type JourneyRequest = {
	from: StationArgument;
	to: StationArgument;
	limit: number;
	max_changes: number;
	min_interchange_min: number;
	/** HH:MM, UK local. null when not given. */
	from_time: string | null;
	/** HH:MM, UK local. null when not given. */
	to_time: string | null;
};

/**
 * A TRUST movement report. location is null when the report's location is not in our location data.
 */
export type Report = {
	location: Place | null;
	/** ISO 8601 with the UK offset, e.g. 2026-10-05T14:26:00+01:00. */
	at: string;
	/** TRUST reports a pass as a departure. */
	event: "arrival" | "departure";
	/** Negative is early. */
	delay_minutes: number;
	/** Reported somewhere its schedule does not go. */
	off_route: boolean;
	platform: Platform;
};

/** In today's timetable, with no movement reports yet. */
export type ProgressNotStarted = {
	type: "not_started";
	/** TRUST has activated it: it is expected to run. */
	activated: boolean;
	/** Booked departure from its origin. */
	departs: string;
	/** Booked arrival at its destination. */
	arrives: string | null;
};

export type ProgressRunning = {
	type: "running";
	last_report: Report;
};

/** Arrived at its destination. */
export type ProgressFinished = {
	type: "finished";
	last_report: Report;
};

export type Progress = ProgressNotStarted | ProgressRunning | ProgressFinished;

/**
 * One run of a train. origin and destination are null when no schedule matched the run.
 */
export type TrainRun = {
	train: Train;
	/** YYYY-MM-DD */
	run_date: string;
	origin: Place | null;
	destination: Place | null;
	progress: Progress;
};

export type TrainRequest = {
	headcode: string | null;
	train_id: string | null;
	operator: string | null;
	origin: string | null;
	destination: string | null;
	date: string | null;
};

export type LastSeen = {
	location: Place | null;
	/** ISO 8601 with the UK offset, e.g. 2026-10-05T14:26:00+01:00. */
	at: string;
};

export type DelayedTrain = {
	train: Train;
	service_class: ServiceClass;
	origin: Place | null;
	destination: Place | null;
	delay_minutes: number;
	off_route: boolean;
	last_seen: LastSeen;
};

export type DelaysRequest = {
	min_minutes: number;
	limit: number;
	passenger_only: boolean;
};

export type CancellationReason = {
	/** Delay Attribution code, e.g. TG. */
	code: string;
	description: string;
	category: string;
	/**
	 * A planned reduction (engineering work and the like) rather than something going wrong.
	 */
	planned: boolean;
};

/** Cancelled at its origin, before it started (TRUST: AT ORIGIN). */
export type CancelledBeforeDeparture = {
	type: "before_departure";
	at: Place;
};

/** Started, and was cancelled from here on (TRUST: EN ROUTE). */
export type CancelledPartWay = {
	type: "part_way";
	at: Place;
};

/**
 * A schedule that only runs when called upon, and was not needed (TRUST: ON CALL).
 */
export type CancelledNotNeeded = {
	type: "not_needed";
	at: Place;
};

/**
 * Cancelled while running somewhere its schedule does not go (TRUST: OUT OF PLAN).
 */
export type CancelledOffBookedPath = {
	type: "off_booked_path";
	at: Place;
};

/** Where in its run the train was cancelled, and where that was. */
export type CancellationKind = CancelledBeforeDeparture | CancelledPartWay | CancelledNotNeeded | CancelledOffBookedPath;

/**
 * origin, destination, train.uid and train.operator are null when TRUST cancelled a train before activating it, so its schedule is unknown; service_class is then unknown.
 */
export type Cancellation = {
	train: Train;
	service_class: ServiceClass;
	origin: Place | null;
	destination: Place | null;
	cancelled: CancellationKind;
	reason: CancellationReason;
	/** When we received it. */
	reported_at: string;
	/**
	 * When it was entered into TRUST. Can be hours before, for a cancellation planned ahead.
	 */
	keyed_at: string;
};

export type CancellationsRequest = {
	limit: number;
	passenger_only: boolean;
};

/** A movement TRUST reported at the station. */
export type Movement = {
	train: TrainRef;
	location: Place;
	event: "arrival" | "departure";
	time: Time;
	platform: Platform;
	off_route: boolean;
};

export type ActivityRequest = {
	station: StationArgument;
	limit: number;
};

export type StationMatchStation = {
	type: "station";
	crs: string;
	name: string;
	tiploc: string;
	stanox: string | null;
	calls_today: number;
};

/** Somewhere that is not a public station. */
export type StationMatchLocation = {
	type: "location";
	kind: "depot" | "infrastructure" | "other";
	name: string;
	/** Some depots and sidings carry an operational code. */
	crs: string | null;
	tiploc: string;
	stanox: string | null;
	calls_today: number;
};

export type StationMatch = StationMatchStation | StationMatchLocation;

/**
 * resolves_to is the group, alias or landmark the query itself names, or null.
 */
export type StationSearch = {
	resolves_to: Resolution | null;
	matches: StationMatch[];
	/** true when nothing matched as written and these are the closest names. */
	near_misses: boolean;
};

export type StationsRequest = {
	/** The query as searched. */
	q: string;
};

export type Summary = {
	service_date: string;
	/** Runs in today's timetable. */
	scheduled: number;
	/** Of those, activated so far. */
	started: number;
	running_now: {
		count: number;
		window_minutes: number;
	};
	cancelled: {
		total: number;
		/** Withdrawn by the timetable itself. */
		planned: number;
	};
	punctuality: {
		on_time_percent: number;
		definition: string;
		average_lateness_minutes: number;
	};
	movement_reports_today: number;
};

export type EmptyRequest = Record<string, never>;

export type FreshnessFresh = {
	type: "fresh";
	last_stored_seconds_ago: number;
};

export type FreshnessStale = {
	type: "stale";
	last_stored_seconds_ago: number;
};

/** Nothing stored in the window looked at. */
export type FreshnessSilent = {
	type: "silent";
};

/** The database could not be asked. */
export type FreshnessUnknown = {
	type: "unknown";
};

export type Freshness = FreshnessFresh | FreshnessStale | FreshnessSilent | FreshnessUnknown;

export type Feed = {
	stale_after_seconds: number;
	freshness: Freshness;
};

export type TrainsRunningCounted = {
	type: "counted";
	count: number;
};

/** The live map did not answer. */
export type TrainsRunningUnknown = {
	type: "unknown";
};

export type TrainsRunning = TrainsRunningCounted | TrainsRunningUnknown;

export type Status = {
	/** ok only when every feed is fresh. */
	health: "ok" | "degraded";
	feeds: {
		trust: Feed;
		td: Feed;
		darwin: Feed;
	};
	trains_running: TrainsRunning;
	/** ISO 8601 with the UK offset, e.g. 2026-10-05T14:26:00+01:00. */
	measured_at: string;
};

export type IndexEndpoint = {
	path: string;
	query: string[];
	description: string;
};

export type Index = {
	name: string;
	description: string;
	openapi: string;
	docs: string;
	mcp: string;
	endpoints: IndexEndpoint[];
};

/** HTTP 404. */
export type ErrorStationNotFound = {
	type: "station_not_found";
	/** station, from, to or calling_at. */
	parameter: string;
	query: string;
	/** Near misses, never acted on for you. Empty when nothing came close. */
	did_you_mean: Station[];
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 400. */
export type ErrorStationAmbiguous = {
	type: "station_ambiguous";
	parameter: string;
	query: string;
	candidates: Station[];
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 400. */
export type ErrorSameStation = {
	type: "same_station";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 400. */
export type ErrorParameterOutOfRange = {
	type: "parameter_out_of_range";
	parameter: string;
	value: number;
	min: number;
	max: number;
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 400. */
export type ErrorInvalidParameter = {
	type: "invalid_parameter";
	parameter: string;
	value: string;
	expected: "integer" | "boolean" | "time" | "date" | "headcode";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 400. */
export type ErrorMissingParameter = {
	type: "missing_parameter";
	/** Give at least one of these. */
	parameters: string[];
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 404. */
export type ErrorTrainNotFound = {
	type: "train_not_found";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 404: no such endpoint. */
export type ErrorNotFound = {
	type: "not_found";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 405. */
export type ErrorMethodNotAllowed = {
	type: "method_not_allowed";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 429. */
export type ErrorRateLimited = {
	type: "rate_limited";
	retry_after_seconds: number;
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 503. */
export type ErrorDatabaseBusy = {
	type: "database_busy";
	retry_after_seconds: number;
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 503. */
export type ErrorDatabaseUnavailable = {
	type: "database_unavailable";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 503. */
export type ErrorQueryFailed = {
	type: "query_failed";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 503. */
export type ErrorStatusUnavailable = {
	type: "status_unavailable";
	retry_after_seconds: number;
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

/** HTTP 500. */
export type ErrorInternal = {
	type: "internal_error";
	/** For a person reading a log. Branch on type, never on this. */
	message: string;
};

export type ApiError = ErrorStationNotFound | ErrorStationAmbiguous | ErrorSameStation | ErrorParameterOutOfRange | ErrorInvalidParameter | ErrorMissingParameter | ErrorTrainNotFound | ErrorNotFound | ErrorMethodNotAllowed | ErrorRateLimited | ErrorDatabaseBusy | ErrorDatabaseUnavailable | ErrorQueryFailed | ErrorStatusUnavailable | ErrorInternal;

export type ErrorResponse = {
	type: "error";
	error: ApiError;
};

export type DeparturesResponse = {
	type: "ok";
	request: DeparturesRequest;
	data: Departure[];
	/** When the database answered. */
	generated_at: string;
};

export type JourneyResponse = {
	type: "ok";
	request: JourneyRequest;
	data: Journey[];
	/** When the database answered. */
	generated_at: string;
};

export type TrainResponse = {
	type: "ok";
	request: TrainRequest;
	data: TrainRun[];
	/** When the database answered. */
	generated_at: string;
};

export type DelaysResponse = {
	type: "ok";
	request: DelaysRequest;
	data: DelayedTrain[];
	/** When the database answered. */
	generated_at: string;
};

export type CancellationsResponse = {
	type: "ok";
	request: CancellationsRequest;
	data: Cancellation[];
	/** When the database answered. */
	generated_at: string;
};

export type SummaryResponse = {
	type: "ok";
	request: EmptyRequest;
	data: Summary;
	/** When the database answered. */
	generated_at: string;
};

export type StationsResponse = {
	type: "ok";
	request: StationsRequest;
	data: StationSearch;
	/** When the database answered. */
	generated_at: string;
};

export type ActivityResponse = {
	type: "ok";
	request: ActivityRequest;
	data: Movement[];
	/** When the database answered. */
	generated_at: string;
};

export type StatusResponse = {
	type: "ok";
	request: EmptyRequest;
	data: Status;
	/** When the database answered. */
	generated_at: string;
};

export type IndexResponse = {
	type: "ok";
	request: EmptyRequest;
	data: Index;
	/** When the database answered. */
	generated_at: string;
};

/** What a 200 from each path carries. Every other status is an `ErrorResponse`. */
export type Responses = {
	/** What is here. */
	"/v1": IndexResponse;
	/** Live departure board. */
	"/v1/departures/{station}": DeparturesResponse;
	/** Next trains from one station to another. */
	"/v1/journey/{from}/{to}": JourneyResponse;
	/** Where a train is. */
	"/v1/train": TrainResponse;
	/** The worst-delayed trains running now. */
	"/v1/delays": DelaysResponse;
	/** Today's cancellations, most recent first. */
	"/v1/cancellations": CancellationsResponse;
	/** Today's headline numbers. */
	"/v1/summary": SummaryResponse;
	/** Find stations and other locations. */
	"/v1/stations": StationsResponse;
	/** Movements at a station in the last 3 hours. */
	"/v1/stations/{station}/activity": ActivityResponse;
	/** Feed freshness and trains running. */
	"/v1/status": StatusResponse;
};

/** Anything a path can answer. Switch on `type`. */
export type Answer<P extends keyof Responses> = Responses[P] | ErrorResponse;
